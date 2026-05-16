"""
EDR Agent — main.py

Kiến trúc: HTTP polling thuần, không có WebSocket.

Luồng:
  Mỗi 30s → POST /api/heartbeat { metrics }
           ← { status, agentId, commands: [...] }
  Nếu có lệnh → verify HMAC → execute trong thread riêng
  Sau khi thực thi → PATCH /api/commands/:id/done { status, result }
"""

import time
import yaml
import requests
import uuid
import socket
import logging
import json
import threading
import subprocess

from modules.collector      import collect_metrics, get_suspicious_network_connections
from modules.responder      import (block_ip, unblock_ip, add_custom_rule,
                                    delete_custom_rule, kill_process, delete_rule_by_num)
from modules.metric_exporter import run_metrics
from modules.security       import verify_and_extract_command, SecurityError

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


# ─── Config & Identity ────────────────────────────────────────────────────────

def load_config():
    with open('config.yaml', 'r') as f:
        return yaml.safe_load(f)


def get_agent_id():
    try:
        with open('.agent_id', 'r') as f:
            return f.read().strip()
    except FileNotFoundError:
        new_id = str(uuid.uuid4())
        with open('.agent_id', 'w') as f:
            f.write(new_id)
        return new_id


# ─── Helpers ──────────────────────────────────────────────────────────────────

def send_event(backend_url, agent_id, etype, data, api_secret):
    try:
        requests.post(
            f"{backend_url}/api/events",
            json={"agentId": agent_id, "type": etype, "data": json.dumps(data)},
            headers={"X-Agent-Key": api_secret},
            timeout=5,
        )
    except Exception:
        pass


def get_current_iptables():
    try:
        res = subprocess.run(["iptables", "-L", "-n", "--line-numbers"],
                             capture_output=True, text=True)
        return res.stdout if res.returncode == 0 else f"Error: {res.stderr.strip()}"
    except Exception as e:
        return f"Error: {e}"


# ─── Command Executor ─────────────────────────────────────────────────────────

def execute_command_logic(backend_url, agent_id, cmd, api_secret):
    cmd_id = cmd.get('id')

    try:
        command = verify_and_extract_command(cmd, api_secret)
    except SecurityError as e:
        logging.error(f"[Security] REJECT command {cmd_id}: {e}")
        try:
            requests.patch(
                f"{backend_url}/api/commands/{cmd_id}/done",
                json={"status": "failed", "result": f"SECURITY: Signature không hợp lệ — {e}"},
                headers={"X-Agent-Key": api_secret},
                timeout=5,
            )
        except Exception:
            pass
        return

    action = command.get('action')
    params = command.get('params', '{}')
    if isinstance(params, str):
        params = json.loads(params)

    logging.info(f"[CMD] ✓ Thực thi: {action}")

    success    = False
    result_msg = "Không có phản hồi"

    try:
        if action == 'block_ip':
            ip = params.get('ip')
            if not ip:
                result_msg = "Thiếu tham số 'ip'"
            else:
                success = block_ip(ip)
                if success:
                    result_msg = f"Đã chặn IP {ip}"
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "blocked_ip", "connection": {"remote_ip": ip, "remote_port": "manual"}},
                               api_secret)
                else:
                    result_msg = f"Không thể chặn IP {ip} — kiểm tra quyền root"

        elif action == 'unblock_ip':
            ip = params.get('ip')
            if not ip:
                result_msg = "Thiếu tham số 'ip'"
            else:
                success = unblock_ip(ip)
                if success:
                    result_msg = f"Đã gỡ chặn IP {ip}"
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "unblocked_ip", "ip": ip}, api_secret)
                else:
                    result_msg = f"Không thể gỡ chặn IP {ip} — rule có thể không tồn tại"

        elif action == 'kill_process':
            pid = params.get('pid')
            if not pid:
                result_msg = "Thiếu tham số 'pid'"
            else:
                success = kill_process(pid)
                result_msg = (f"Đã kill process PID {pid}" if success
                              else f"Không thể kill PID {pid} — process không tồn tại hoặc thiếu quyền")

        elif action == 'add_rule':
            chain    = params.get('chain', 'INPUT')
            protocol = params.get('protocol', 'tcp')
            port     = params.get('port')
            target   = params.get('target', 'ACCEPT')
            success  = add_custom_rule(
                chain, protocol, port, target,
                params.get('log', False),
                params.get('states', []),
                priority   = params.get('priority'),
                src_invert = params.get('srcInvert', False),
                src_type   = params.get('srcType', 'any'),
                src_attr   = params.get('src', ''),
                src_mask   = params.get('srcMask', ''),
                sport      = params.get('sport', ''),
                dst_invert = params.get('dstInvert', False),
                dst_type   = params.get('dstType', 'any'),
                dst_attr   = params.get('dst', ''),
                dst_mask   = params.get('dstMask', ''),
                log_prefix = params.get('logPrefix', f"FW_LOG_{target}: "),
            )
            if success:
                port_str = f" port {port}" if port else ""
                src_str  = f" src {params.get('src')}" if params.get('src') else ""
                result_msg = f"Đã thêm rule {chain} {protocol}{port_str}{src_str} → {target}"
                send_event(backend_url, agent_id, 'Network', {
                    "action": "added_rule", "chain": chain,
                    "protocol": protocol, "port": port, "target": target,
                }, api_secret)
            else:
                result_msg = f"Không thể thêm rule — kiểm tra cú pháp và quyền root"

        elif action == 'delete_rule':
            chain = params.get('chain', 'INPUT')
            num   = params.get('num')
            if num:
                success = delete_rule_by_num(chain, num)
                if success:
                    result_msg = f"Đã xóa rule số {num} khỏi chain {chain}"
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "deleted_rule", "chain": chain, "num": num}, api_secret)
                else:
                    result_msg = f"Không thể xóa rule số {num}"
            else:
                port   = params.get('port')
                target = params.get('target', 'ACCEPT')
                if not port:
                    result_msg = "Thiếu 'num' hoặc 'port'"
                else:
                    success = delete_custom_rule(chain, params.get('protocol', 'tcp'), port, target)
                    if success:
                        result_msg = f"Đã xóa rule {chain} port {port} → {target}"
                        send_event(backend_url, agent_id, 'Network', {
                            "action": "deleted_rule", "chain": chain,
                            "protocol": params.get('protocol', 'tcp'),
                            "port": port, "target": target,
                        }, api_secret)
                    else:
                        result_msg = f"Không tìm thấy rule {chain} port {port} → {target}"

        else:
            result_msg = f"Action không được nhận dạng: '{action}'"

    except Exception as e:
        result_msg = f"Exception: {e}"
        logging.error(f"[CMD] Lỗi thực thi: {e}")

    status_val = "done" if success else "failed"
    try:
        requests.patch(
            f"{backend_url}/api/commands/{cmd_id}/done",
            json={"status": status_val, "result": result_msg},
            headers={"X-Agent-Key": api_secret},
            timeout=5,
        )
    except Exception as e:
        logging.error(f"[CMD] Không gửi được kết quả về backend: {e}")

    logging.info(f"[CMD] {action} → {status_val.upper()} | {result_msg}")


# ─── Heartbeat + Poll Thread ──────────────────────────────────────────────────

def heartbeat_loop(backend_url, agent_id, hostname, api_secret, interval=30):
    """
    Mỗi `interval` giây:
      1. Gửi metrics lên backend
      2. Nhận về danh sách lệnh pending trong response
      3. Execute từng lệnh trong thread daemon riêng
    """
    while True:
        try:
            metrics        = collect_metrics()
            iptables_rules = get_current_iptables()

            res = requests.post(
                f"{backend_url}/api/heartbeat",
                json={
                    "agentId":            agent_id,
                    "hostname":           hostname,
                    "cpu_percent":        metrics['cpu_percent'],
                    "memory_percent":     metrics['memory_percent'],
                    "network_interfaces": metrics.get("network_interfaces", []),
                    "iptables_rules":     iptables_rules,
                },
                headers={"X-Agent-Key": api_secret},
                timeout=10,
            )

            data     = res.json()
            commands = data.get('commands', [])

            if commands:
                logging.info(f"[HB] Nhận {len(commands)} lệnh")
                for cmd in commands:
                    threading.Thread(
                        target=execute_command_logic,
                        args=(backend_url, agent_id, cmd, api_secret),
                        daemon=True,
                    ).start()
            else:
                logging.info(f"[HB] CPU {metrics['cpu_percent']}% | RAM {metrics['memory_percent']}% | Không có lệnh mới")

            # Quét và tự động chặn kết nối nghi ngờ
            for conn in get_suspicious_network_connections():
                remote_ip = conn['remote_ip']
                logging.warning(f"[HB] Kết nối nghi ngờ: {remote_ip}:{conn['remote_port']}")
                if block_ip(remote_ip):
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "blocked_ip", "connection": conn}, api_secret)

        except Exception as e:
            logging.error(f"[HB] Lỗi: {e}")

        time.sleep(interval)


# ─── Entry Point ──────────────────────────────────────────────────────────────

def main():
    config      = load_config()
    backend_url = config.get('backend_url', 'http://localhost:3000')
    agent_id    = get_agent_id()
    hostname    = socket.gethostname()
    api_secret  = config.get('api_key')

    if not api_secret or len(api_secret) < 32:
        logging.error("─" * 60)
        logging.error("   CẢNH BÁO: api_key chưa được cấu hình trong config.yaml!")
        logging.error("   Thêm dòng: api_key: <key_từ_backend/.env>")
        logging.error("─" * 60)
        time.sleep(5)

    logging.info(f"=== EDR Agent | ID: {agent_id} | Host: {hostname} ===")
    logging.info(f"    Backend : {backend_url}")
    logging.info(f"    Security: HMAC {'✓ enabled' if api_secret else '✗ DISABLED'}")
    logging.info(f"    Mode    : HTTP polling (heartbeat mỗi 30s)")

    threads = [
        threading.Thread(
            target=heartbeat_loop,
            args=(backend_url, agent_id, hostname, api_secret),
            daemon=True,
        ),
        threading.Thread(target=run_metrics, daemon=True),
    ]

    for t in threads:
        t.start()

    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
