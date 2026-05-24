"""
EDR Agent — main.py

Kiến trúc: Backend PUSH qua HTTPS + Agent PUSH kết quả qua Redis.

Luồng lệnh:
  Backend → POST https://agent:8443/command { cmd + signature }
          ← 202 Accepted  (ngay lập tức)
  Agent verify HMAC → thực thi → redis.RPUSH results:queue { result }
  Backend ResultConsumer BLPOP results:queue → cập nhật DB + broadcast dashboard

Fallback (khi agent offline / không reach được):
  Backend RPUSH cmd:pending:{agentId}
  Agent heartbeat mỗi 30s → nhận lệnh fallback → thực thi → Redis push kết quả

Heartbeat:
  Mỗi 30s → POST /api/heartbeat { metrics, port }
           ← { status, agentId, commands: [...] }   ← lệnh fallback nếu có
"""

import time
import yaml
import requests
import redis as redis_lib
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
from modules.agent_server   import run_agent_server

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

RESULTS_KEY = 'results:queue'


# ─── Config & Identity ────────────────────────────────────────────────────────

def load_config():
    with open('config.yaml', 'r') as f:
        return yaml.safe_load(f)


def parse_ssl_verify(raw):
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        if raw.lower() == 'false':
            return False
        if raw.lower() == 'true':
            return True
        return raw
    return False


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

def send_event(backend_url, agent_id, etype, data, api_secret, ssl_verify=False):
    try:
        requests.post(
            f"{backend_url}/api/events",
            json={"agentId": agent_id, "type": etype, "data": json.dumps(data)},
            headers={"X-Agent-Key": api_secret},
            timeout=5,
            verify=ssl_verify,
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


def push_result(redis_client, command_id, agent_id, status, result_msg):
    """Đẩy kết quả thực thi vào Redis queue để backend consumer xử lý."""
    try:
        redis_client.rpush(RESULTS_KEY, json.dumps({
            'commandId': command_id,
            'agentId':   agent_id,
            'status':    status,
            'result':    result_msg,
        }))
    except Exception as e:
        logging.error(f"[Redis] Không push được kết quả: {e}")


# ─── Command Executor ─────────────────────────────────────────────────────────

def execute_command_logic(backend_url, agent_id, cmd, api_secret,
                          redis_client, ssl_verify=False):
    cmd_id = cmd.get('id')

    try:
        command = verify_and_extract_command(cmd, api_secret)
    except SecurityError as e:
        logging.error(f"[Security] REJECT command {cmd_id}: {e}")
        push_result(redis_client, cmd_id, agent_id,
                    'failed', f"SECURITY: Signature không hợp lệ — {e}")
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
                               api_secret, ssl_verify)
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
                               {"action": "unblocked_ip", "ip": ip}, api_secret, ssl_verify)
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
                }, api_secret, ssl_verify)
            else:
                result_msg = "Không thể thêm rule — kiểm tra cú pháp và quyền root"

        elif action == 'delete_rule':
            chain = params.get('chain', 'INPUT')
            num   = params.get('num')
            if num:
                success = delete_rule_by_num(chain, num)
                if success:
                    result_msg = f"Đã xóa rule số {num} khỏi chain {chain}"
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "deleted_rule", "chain": chain, "num": num},
                               api_secret, ssl_verify)
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
                        }, api_secret, ssl_verify)
                    else:
                        result_msg = f"Không tìm thấy rule {chain} port {port} → {target}"

        else:
            result_msg = f"Action không được nhận dạng: '{action}'"

    except Exception as e:
        result_msg = f"Exception: {e}"
        logging.error(f"[CMD] Lỗi thực thi: {e}")

    status_val = "done" if success else "failed"
    push_result(redis_client, cmd_id, agent_id, status_val, result_msg)
    logging.info(f"[CMD] {action} → {status_val.upper()} | {result_msg}")


# ─── Heartbeat — Metrics + Fallback Commands ──────────────────────────────────

def heartbeat_loop(backend_url, agent_id, hostname, api_secret,
                   listen_port, redis_client, ssl_verify=False, interval=30):
    """
    Mỗi `interval` giây:
      1. Gửi metrics + listen_port lên backend (backend lưu agent.url từ port này)
      2. Nhận lệnh fallback (chỉ có khi direct push thất bại trước đó)
      3. Thực thi fallback commands — kết quả vẫn đi qua Redis
      4. Tự động chặn kết nối nghi ngờ
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
                    "port":               listen_port,
                    "cpu_percent":        metrics['cpu_percent'],
                    "memory_percent":     metrics['memory_percent'],
                    "network_interfaces": metrics.get("network_interfaces", []),
                    "iptables_rules":     iptables_rules,
                },
                headers={"X-Agent-Key": api_secret},
                timeout=10,
                verify=ssl_verify,
            )

            data     = res.json()
            commands = data.get('commands', [])

            if commands:
                logging.info(f"[HB] Nhận {len(commands)} lệnh fallback")
                for cmd in commands:
                    threading.Thread(
                        target=execute_command_logic,
                        args=(backend_url, agent_id, cmd, api_secret, redis_client, ssl_verify),
                        daemon=True,
                    ).start()
            else:
                logging.info(f"[HB] CPU {metrics['cpu_percent']}% | RAM {metrics['memory_percent']}% | OK")

            for conn in get_suspicious_network_connections():
                remote_ip = conn['remote_ip']
                logging.warning(f"[HB] Kết nối nghi ngờ: {remote_ip}:{conn['remote_port']}")
                if block_ip(remote_ip):
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "blocked_ip", "connection": conn},
                               api_secret, ssl_verify)

        except Exception as e:
            logging.error(f"[HB] Lỗi: {e}")

        time.sleep(interval)


# ─── Entry Point ──────────────────────────────────────────────────────────────

def main():
    config      = load_config()
    backend_url = config.get('backend_url', 'https://localhost:3000')
    agent_id    = get_agent_id()
    hostname    = socket.gethostname()
    api_secret  = config.get('api_key')
    ssl_verify  = parse_ssl_verify(config.get('ssl_verify', False))
    listen_port = config.get('listen_port', 8443)
    agent_cert  = config.get('agent_cert', './certs/agent-cert.pem')
    agent_key   = config.get('agent_key',  './certs/agent-key.pem')
    redis_url   = config.get('redis_url',  'redis://localhost:6379')

    if not api_secret or len(api_secret) < 32:
        logging.error("─" * 60)
        logging.error("   CẢNH BÁO: api_key chưa được cấu hình trong config.yaml!")
        logging.error("─" * 60)
        time.sleep(5)

    redis_client = redis_lib.Redis.from_url(redis_url, decode_responses=True)
    try:
        redis_client.ping()
        logging.info(f"[Redis] Connected → {redis_url}")
    except Exception as e:
        logging.error(f"[Redis] Không kết nối được: {e}")

    ssl_label = ("✗ tắt (self-signed)" if ssl_verify is False
                 else ("✓ CA hệ thống" if ssl_verify is True
                       else f"✓ cert: {ssl_verify}"))

    logging.info(f"=== EDR Agent | ID: {agent_id} | Host: {hostname} ===")
    logging.info(f"    Backend    : {backend_url}")
    logging.info(f"    Auth       : HMAC {'✓ enabled' if api_secret else '✗ DISABLED'}")
    logging.info(f"    TLS verify : {ssl_label}")
    logging.info(f"    Server     : HTTPS :{listen_port}  (nhận lệnh trực tiếp)")
    logging.info(f"    Results    : Redis {redis_url} → {RESULTS_KEY}")

    def _server_callback(cmd):
        execute_command_logic(backend_url, agent_id, cmd, api_secret,
                              redis_client, ssl_verify)

    threads = [
        threading.Thread(
            target=run_agent_server,
            args=(listen_port, agent_cert, agent_key, api_secret, _server_callback),
            daemon=True,
        ),
        threading.Thread(
            target=heartbeat_loop,
            args=(backend_url, agent_id, hostname, api_secret,
                  listen_port, redis_client, ssl_verify),
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
