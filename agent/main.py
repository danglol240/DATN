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


def socket_metrics_thread(agent_id, hostname):
    """Push metrics via Socket.IO every 10 s for real-time dashboard updates.
    Runs as a daemon thread alongside the HTTP heartbeat loop."""
    while True:
        time.sleep(10)
        if not sio.connected:
            continue
        try:
            metrics  = collect_metrics()
            iptables = get_current_iptables()
            sio.emit('metrics_update', {
                'agentId':            agent_id,
                'hostname':           hostname,
                'cpu_percent':        metrics['cpu_percent'],
                'memory_percent':     metrics['memory_percent'],
                'network_interfaces': metrics.get('network_interfaces', []),
                'iptables_rules':     iptables,
            })
        except Exception as e:
            logging.error(f"[SOCKET] Lỗi gửi metrics: {e}")


def main():
    config      = load_config()
    backend_url = config.get('backend_url', 'http://localhost:3000')
    interval    = config.get('heartbeat_interval', 120)
    agent_id    = get_agent_id()
    hostname    = socket.gethostname()

    logging.info(f"== Agent Khởi Động | ID: {agent_id} ==")

    @sio.event
    def connect():
        logging.info("WebSocket: Đã kết nối với backend")
        sio.emit('register_agent', agent_id)
        # Catch up on any commands that arrived while we were offline
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

    threading.Thread(target=ws_thread, daemon=True).start()
    threading.Thread(target=socket_metrics_thread, args=(agent_id, hostname), daemon=True).start()

    # HTTP heartbeat loop — reliable DB sync fallback when socket is unavailable
    while True:
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
        try:
            requests.post(f"{backend_url}/api/heartbeat", json=payload, timeout=5)
            logging.info(f"Heartbeat: CPU {metrics['cpu_percent']}% | RAM {metrics['memory_percent']}%")

            suspicious_conns = get_suspicious_network_connections()
            for conn in suspicious_conns:
                remote_ip = conn['remote_ip']
                logging.warning(f"Phát hiện kết nối nghi ngờ tới {remote_ip}:{conn['remote_port']}")
                if block_ip(remote_ip):
                    send_event(backend_url, agent_id, 'Network',
                               {"action": "blocked_ip", "connection": conn})
        except requests.exceptions.RequestException as e:
            logging.error(f"Lỗi kết nối Backend: {e}")
        except Exception as e:
            logging.error(f"Lỗi nội bộ Agent: {e}")

        time.sleep(interval)


if __name__ == "__main__":
    main()
