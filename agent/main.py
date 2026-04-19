import time
import yaml
import requests
import uuid
import socket
import logging
import json
import threading
import subprocess
import socketio
from modules.collector import collect_metrics, get_suspicious_network_connections
from modules.responder import block_ip, unblock_ip, add_custom_rule, delete_custom_rule, kill_process, delete_rule_by_num

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

sio = socketio.Client(logger=False, engineio_logger=False)


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


def send_event(backend_url, agent_id, etype, data):
    try:
        requests.post(
            f"{backend_url}/api/events",
            json={"agentId": agent_id, "type": etype, "data": json.dumps(data)},
            timeout=5,
        )
    except Exception:
        pass


def get_current_iptables():
    try:
        res = subprocess.run(["iptables", "-L", "-n", "--line-numbers"], capture_output=True, text=True)
        if res.returncode != 0:
            return f"Error ({res.returncode}): {res.stderr.strip()}"
        return res.stdout
    except Exception as e:
        return f"Error getting iptables: {e}"


def execute_command_logic(backend_url, agent_id, cmd):
    try:
        action = cmd.get('action')
        params = json.loads(cmd.get('params', '{}'))
        cmd_id = cmd.get('id')
        logging.info(f"[CMD] Nhận lệnh: {action} | params: {params}")

        success = False
        if action == 'block_ip':
            ip = params.get('ip')
            if ip:
                success = block_ip(ip)
                if success:
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "blocked_ip", "connection": {"remote_ip": ip, "remote_port": "manual"}})
        elif action == 'unblock_ip':
            ip = params.get('ip')
            if ip:
                success = unblock_ip(ip)
                if success:
                    send_event(backend_url, agent_id, 'Network', {"action": "unblocked_ip", "ip": ip})
        elif action == 'kill_process':
            pid = params.get('pid')
            if pid:
                success = kill_process(pid)
        elif action == 'add_rule':
            chain      = params.get('chain', 'INPUT')
            protocol   = params.get('protocol', 'tcp')
            port       = params.get('port')
            target     = params.get('target', 'ACCEPT')
            log        = params.get('log', False)
            states     = params.get('states', [])
            priority   = params.get('priority')
            src_invert = params.get('srcInvert', False)
            src_type   = params.get('srcType', 'any')
            src_attr   = params.get('src', '')
            src_mask   = params.get('srcMask', '')
            sport      = params.get('sport', '')
            dst_invert = params.get('dstInvert', False)
            dst_type   = params.get('dstType', 'any')
            dst_attr   = params.get('dst', '')
            dst_mask   = params.get('dstMask', '')
            log_prefix = params.get('logPrefix', f"FW_LOG_{target}: ")
            success = add_custom_rule(
                chain, protocol, port, target, log, states,
                priority=priority, src_invert=src_invert, src_type=src_type, src_attr=src_attr,
                src_mask=src_mask, sport=sport, dst_invert=dst_invert, dst_type=dst_type,
                dst_attr=dst_attr, dst_mask=dst_mask, log_prefix=log_prefix,
            )
            if success:
                send_event(backend_url, agent_id, 'Network', {
                    "action": "added_rule", "chain": chain, "protocol": protocol,
                    "port": port, "target": target, "log": log, "states": states,
                    "priority": priority, "src": src_attr, "dst": dst_attr,
                })
        elif action == 'delete_rule':
            chain = params.get('chain', 'INPUT')
            num   = params.get('num')
            if num:
                success = delete_rule_by_num(chain, num)
                if success:
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "deleted_rule", "chain": chain, "num": num})
            else:
                protocol = params.get('protocol', 'tcp')
                port     = params.get('port')
                target   = params.get('target', 'ACCEPT')
                if port:
                    success = delete_custom_rule(chain, protocol, port, target)
                    if success:
                        send_event(backend_url, agent_id, 'Network', {
                            "action": "deleted_rule", "chain": chain,
                            "protocol": protocol, "port": port, "target": target,
                        })

        status_val = "done" if success else "failed"
        requests.patch(
            f"{backend_url}/api/commands/{cmd_id}/done",
            json={"status": status_val},
            timeout=5,
        )
        logging.info(f"[CMD] Lệnh {action} {'thành công' if success else 'thất bại'}")
    except Exception as e:
        logging.error(f"[CMD] Lỗi thực thi lệnh: {e}")


# ---------------------------------------------------------------------------
# METRICS — HTTP, mỗi 45s
# Gửi đầy đủ CPU/RAM/iptables lên backend và quét kết nối nghi ngờ.
# Tách khỏi heartbeat để dashboard luôn có dữ liệu mới mà không tốn băng thông
# heartbeat.
# ---------------------------------------------------------------------------
def metrics_thread_fn(backend_url, agent_id, hostname, interval=60):
    while True:
        time.sleep(interval)
        try:
            metrics       = collect_metrics()
            iptables_rules = get_current_iptables()
            payload = {
                "agentId":            agent_id,
                "hostname":           hostname,
                "cpu_percent":        metrics['cpu_percent'],
                "memory_percent":     metrics['memory_percent'],
                "network_interfaces": metrics.get("network_interfaces", []),
                "iptables_rules":     iptables_rules,
            }
            requests.post(f"{backend_url}/api/heartbeat", json=payload, timeout=5)
            logging.info(f"[METRICS] CPU {metrics['cpu_percent']}% | RAM {metrics['memory_percent']}%")

            # Quét và tự động chặn các kết nối nghi ngờ
            for conn in get_suspicious_network_connections():
                remote_ip = conn['remote_ip']
                logging.warning(f"[METRICS] Kết nối nghi ngờ: {remote_ip}:{conn['remote_port']}")
                if block_ip(remote_ip):
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "blocked_ip", "connection": conn})
        except Exception as e:
            logging.error(f"[METRICS] Lỗi: {e}")


# ---------------------------------------------------------------------------
# HEARTBEAT — HTTP, mỗi 120s
# Ping đơn giản để backend xác nhận agent còn sống, dự phòng khi metrics lỗi.
# ---------------------------------------------------------------------------
def heartbeat_thread_fn(backend_url, agent_id, hostname, interval=120):
    while True:
        time.sleep(interval)
        try:
            requests.post(
                f"{backend_url}/api/heartbeat",
                json={"agentId": agent_id, "hostname": hostname},
                timeout=5,
            )
            logging.info("[HEARTBEAT] Ping OK")
        except Exception as e:
            logging.error(f"[HEARTBEAT] Lỗi: {e}")


# ---------------------------------------------------------------------------
# RETRY — Background task trên agent, mỗi 60s
# Agent tự kiểm tra và thực thi các lệnh pending bị bỏ lỡ (do mất socket,
# backend restart, hoặc dispatch xảy ra trước khi agent kịp đăng ký lại).
# Không cần backend tạo lại lệnh — agent chủ động pull và tự xử lý.
# ---------------------------------------------------------------------------
def retry_thread_fn(backend_url, agent_id, interval=60):
    while True:
        time.sleep(interval)
        try:
            res = requests.get(f"{backend_url}/api/agents/{agent_id}/commands", timeout=5)
            cmds = res.json()
            if cmds:
                logging.info(f"[RETRY] Tìm thấy {len(cmds)} lệnh pending — thực thi lại")
                for cmd in cmds:
                    threading.Thread(
                        target=execute_command_logic,
                        args=(backend_url, agent_id, cmd),
                        daemon=True,
                    ).start()
        except Exception as e:
            logging.error(f"[RETRY] Lỗi poll lệnh: {e}")


def main():
    config      = load_config()
    backend_url = config.get('backend_url', 'http://localhost:3000')
    agent_id    = get_agent_id()
    hostname    = socket.gethostname()

    logging.info(f"== Agent Khởi Động | ID: {agent_id} ==")

    # ------------------------------------------------------------------
    # WebSocket — CHỈ dùng để nhận lệnh điều khiển real-time (Command)
    # Metrics không đi qua socket nữa, tránh phụ thuộc kết nối liên tục
    # ------------------------------------------------------------------
    @sio.event
    def connect():
        logging.info("WebSocket: Đã kết nối với backend")
        sio.emit('register_agent', agent_id)
        # Pull lệnh bị bỏ lỡ trong thời gian mất kết nối
        try:
            res = requests.get(f"{backend_url}/api/agents/{agent_id}/commands", timeout=5)
            for cmd in res.json():
                execute_command_logic(backend_url, agent_id, cmd)
        except Exception as e:
            logging.error(f"[RECONNECT] Lỗi pull lệnh: {e}")

    @sio.event
    def disconnect():
        logging.info("WebSocket: Đã ngắt kết nối với backend")

    @sio.event
    def new_command(data):
        # Backend thông báo có lệnh mới → pull ngay để nhận đầy đủ dữ liệu
        logging.info("WebSocket: Nhận sự kiện new_command")
        try:
            res = requests.get(f"{backend_url}/api/agents/{agent_id}/commands", timeout=5)
            for cmd in res.json():
                execute_command_logic(backend_url, agent_id, cmd)
        except Exception as e:
            logging.error(f"[CMD] Lỗi pull lệnh sau WS notify: {e}")

    def ws_thread():
        while True:
            try:
                if not sio.connected:
                    sio.connect(backend_url, wait_timeout=10)
                    sio.wait()
            except Exception as e:
                logging.error(f"Lỗi kết nối WebSocket: {e}")
                time.sleep(5)

    # Khởi động 4 luồng chạy song song
    threading.Thread(target=ws_thread,          daemon=True).start()
    threading.Thread(target=metrics_thread_fn,  args=(backend_url, agent_id, hostname), daemon=True).start()
    threading.Thread(target=heartbeat_thread_fn, args=(backend_url, agent_id, hostname), daemon=True).start()
    threading.Thread(target=retry_thread_fn,    args=(backend_url, agent_id), daemon=True).start()

    # Main thread chỉ giữ process sống — mọi công việc đã chạy trong daemon threads
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
