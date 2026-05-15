from prometheus_client import start_http_server, Gauge
import psutil
import time
import subprocess

cpu = Gauge('agent_cpu_usage', 'CPU usage %')
mem = Gauge('agent_memory_usage', 'Memory usage %')
conn = Gauge('agent_connections', 'Connections')
blocked = Gauge('agent_blocked_ips', 'Blocked IPs')

def count_blocked():
    try:
        res = subprocess.run(
            ["iptables", "-L", "INPUT", "-n"],
            capture_output=True,
            text=True
        )
        return res.stdout.count("DROP")
    except:
        return 0

def run_metrics():
    start_http_server(9091)
    while True:
        cpu.set(psutil.cpu_percent())
        mem.set(psutil.virtual_memory().percent)
        conn.set(len(psutil.net_connections()))
        blocked.set(count_blocked())
        time.sleep(5)