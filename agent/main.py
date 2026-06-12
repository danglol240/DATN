"""
EDR Agent — main.py

Kiến trúc: HTTP-first cả 2 chiều, Redis là fallback.

Chiều đi (backend → agent):
  Backend → POST https://agent:8443/command { cmd + signature }   [DIRECT]
          ← 202 Accepted  (ngay lập tức)
  Nếu fail → Backend RPUSH cmd:pending:{agentId}
  Agent heartbeat 30s → nhận lệnh fallback                        [FALLBACK]

Chiều về (agent → backend):
  Agent → POST https://backend/api/commands/result { result }     [DIRECT]
  Nếu fail → Agent RPUSH results:queue
  Backend ResultConsumer BLPOP results:queue                       [FALLBACK]

Cả hai chiều đều cập nhật DB + broadcast Socket.IO tới dashboard.

Heartbeat:
  Mỗi 30s → POST /api/heartbeat { metrics, port }
           ← { status, agentId, commands: [...] }   ← lệnh fallback nếu có
"""

import os
import sys
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
from modules.agent_server   import run_agent_server

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


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

def send_event(backend_url, agent_id, etype, data, api_secret, ssl_verify=False, client_cert=None):
    try:
        requests.post(
            f"{backend_url}/api/events",
            json={"agentId": agent_id, "type": etype, "data": json.dumps(data)},
            headers={"X-Agent-Key": api_secret},
            timeout=5,
            verify=ssl_verify,
            cert=client_cert,
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


def push_result(command_id, agent_id, status, result_msg,
                backend_url, api_secret, ssl_verify=False, client_cert=None):
    payload = {
        'commandId': command_id,
        'agentId':   agent_id,
        'status':    status,
        'result':    result_msg,
    }
    try:
        r = requests.post(
            f"{backend_url}/api/commands/result",
            json=payload,
            headers={"X-Agent-Key": api_secret},
            timeout=5,
            verify=ssl_verify,
            cert=client_cert,
        )
        if r.status_code == 200:
            logging.info(f"[Result] ✓ → {status.upper()} | {result_msg}")
        else:
            logging.error(f"[Result] HTTP {r.status_code} — kết quả không gửi được")
    except Exception as e:
        logging.error(f"[Result] Thất bại: {e}")


# ─── Command Executor ─────────────────────────────────────────────────────────

def execute_command_logic(backend_url, agent_id, cmd, api_secret,
                          ssl_verify=False, client_cert=None, trusted=False):
    cmd_id = cmd.get('id')

    if trusted:
        # mTLS path: danh tính backend đã được xác thực tại TLS handshake — bỏ qua HMAC
        command = cmd
    else:
        # Redis fallback path: không có mTLS → bắt buộc verify HMAC-SHA256
        try:
            command = verify_and_extract_command(cmd, api_secret)
        except SecurityError as e:
            logging.error(f"[Security] REJECT command {cmd_id}: {e}")
            push_result(cmd_id, agent_id,
                        'failed', f"SECURITY: Signature không hợp lệ — {e}",
                        backend_url, api_secret, ssl_verify, client_cert)
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
                               api_secret, ssl_verify, client_cert)
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
                               {"action": "unblocked_ip", "ip": ip}, api_secret, ssl_verify, client_cert)
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
                }, api_secret, ssl_verify, client_cert)
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
                               api_secret, ssl_verify, client_cert)
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
                        }, api_secret, ssl_verify, client_cert)
                    else:
                        result_msg = f"Không tìm thấy rule {chain} port {port} → {target}"

        else:
            result_msg = f"Action không được nhận dạng: '{action}'"

    except Exception as e:
        result_msg = f"Exception: {e}"
        logging.error(f"[CMD] Lỗi thực thi: {e}")

    status_val = "done" if success else "failed"
    push_result(cmd_id, agent_id, status_val, result_msg,
                backend_url, api_secret, ssl_verify, client_cert)


# ─── Heartbeat — Metrics + Fallback Commands ──────────────────────────────────

def heartbeat_loop(backend_url, agent_id, hostname, api_secret,
                   listen_port, ssl_verify=False, client_cert=None, interval=30):
    """Mỗi `interval` giây: gửi metrics lên backend + tự động chặn kết nối nghi ngờ."""
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
                cert=client_cert,
            )
            res.raise_for_status()
            logging.info(f"[HB] CPU {metrics['cpu_percent']}% | RAM {metrics['memory_percent']}% | OK")

            for conn in get_suspicious_network_connections():
                remote_ip = conn['remote_ip']
                logging.warning(f"[HB] Kết nối nghi ngờ: {remote_ip}:{conn['remote_port']}")
                if block_ip(remote_ip):
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "blocked_ip", "connection": conn},
                               api_secret, ssl_verify, client_cert)

        except Exception as e:
            logging.error(f"[HB] Lỗi: {e}")

        time.sleep(interval)


# ─── Entry Point ──────────────────────────────────────────────────────────────

def _check_certs(agent_cert, agent_key, ca_cert):
    """Kiểm tra cert+key có sẵn; nếu không, hướng dẫn dùng add_key.py."""
    missing = [p for p in [agent_cert, agent_key] if not os.path.exists(p)]
    if missing:
        logging.error("─" * 60)
        logging.error("Chưa có TLS cert+key cho agent!")
        logging.error("Chạy lệnh sau để thêm key thủ công:")
        logging.error("")
        logging.error("  openssl req -x509 -newkey rsa:2048 -keyout agent.key \\")
        logging.error("    -out agent.crt -days 3650 -nodes -subj \"/CN=$(hostname)/O=EDR\"")
        logging.error("")
        logging.error("  python add_key.py --cert agent.crt --key agent.key")
        logging.error("─" * 60)
        sys.exit(1)


def main():
    config      = load_config()
    backend_url = config.get('backend_url', 'https://localhost:3000')
    hostname    = socket.gethostname()

    agent_id    = get_agent_id()
    api_secret  = config.get('api_key')
    ssl_verify  = parse_ssl_verify(config.get('ssl_verify', './certs/ca-cert.pem'))
    listen_port = config.get('listen_port', 8443)
    agent_cert  = config.get('agent_cert', './certs/agent-cert.pem')
    agent_key   = config.get('agent_key',  './certs/agent-key.pem')
    ca_cert     = config.get('ca_cert',    './certs/ca-cert.pem')

    _check_certs(agent_cert, agent_key, ca_cert)

    # client_cert: agent trình cert này khi gọi lên backend (mTLS client-side)
    client_cert = (agent_cert, agent_key)

    if not api_secret or len(api_secret) < 32:
        logging.error("─" * 60)
        logging.error("api_key chưa được cấu hình trong config.yaml!")
        logging.error("─" * 60)
        time.sleep(5)

    ssl_label = ("✗ tắt (self-signed)" if ssl_verify is False
                 else ("✓ CA hệ thống" if ssl_verify is True
                       else f"✓ cert: {ssl_verify}"))

    logging.info(f"=== EDR Agent | ID: {agent_id} | Host: {hostname} ===")
    logging.info(f"    Backend    : {backend_url}")
    logging.info(f"    Auth       : X-Agent-Key {'✓' if api_secret else '✗ DISABLED'}")
    logging.info(f"    TLS verify : {ssl_label}")
    logging.info(f"    mTLS client: {'✓ ' + agent_cert if client_cert else '✗ cert không tìm thấy'}")
    logging.info(f"    Server     : HTTPS :{listen_port}  (nhận lệnh trực tiếp qua mTLS)")

    def _server_callback(cmd):
        # trusted=True: lệnh đến qua mTLS — danh tính backend đã được xác thực ở TLS layer
        execute_command_logic(backend_url, agent_id, cmd, api_secret,
                              ssl_verify, client_cert, trusted=True)

    threads = [
        threading.Thread(
            target=run_agent_server,
            args=(listen_port, agent_cert, agent_key, ca_cert, _server_callback),
            daemon=True,
        ),
        threading.Thread(
            target=heartbeat_loop,
            args=(backend_url, agent_id, hostname, api_secret,
                  listen_port, ssl_verify, client_cert),
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
