import psutil

def collect_metrics():
    return {
        "cpu_percent": psutil.cpu_percent(interval=1),
        "memory_percent": psutil.virtual_memory().percent,
        "network_interfaces": list(psutil.net_if_addrs().keys()) if psutil.net_if_addrs() else [],
    }

def get_suspicious_network_connections():
    suspicious_conns = []
    bad_ports = [4444, 1337, 666, 6667] # VD: Các cổng RAT, Reverse Shell thường dùng
    
    try:
        for conn in psutil.net_connections(kind='inet'):
            if conn.status == 'ESTABLISHED' and conn.raddr:
                if conn.raddr.port in bad_ports:
                    suspicious_conns.append({
                        "local_ip": conn.laddr.ip,
                        "local_port": conn.laddr.port,
                        "remote_ip": conn.raddr.ip,
                        "remote_port": conn.raddr.port,
                        "pid": conn.pid
                    })
    except Exception as e:
        pass # Có thể là access denied do chạy không có root
        
    return suspicious_conns
