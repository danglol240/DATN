import subprocess
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

def block_ip(ip_address):
    """
    Thêm rule iptables để chặn kết nối. Yêu cầu quyền root.
    """
    try:
        logging.info(f"Thực hiện block IP: {ip_address}")
        subprocess.run(["iptables", "-I", "INPUT", "-s", ip_address, "-j", "DROP"], capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logging.error(f"Lỗi iptables khi chặn IP {ip_address}: {e}")
        return False
    except Exception as e:
        logging.error(f"Lỗi chặn IP: {e}")
        return False

def unblock_ip(ip_address):
    """
    Gỡ bỏ rule iptables chặn IP.
    """
    try:
        logging.info(f"Thực hiện mở block IP: {ip_address}")
        subprocess.run(["iptables", "-D", "INPUT", "-s", ip_address, "-j", "DROP"], capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logging.error(f"Lỗi iptables khi gỡ chặn IP {ip_address}: {e}")
        return False

def add_custom_rule(chain, protocol, port, target, log=False, states=None, **kwargs):
    """
    Thêm rule iptables tuỳ chỉnh theo port hoặc theo giao thức và theo state.
    """
    try:
        logging.info(f"Thêm rule vào {chain}: {protocol} port {port} -> {target}, log={log}, states={states}, kwargs={kwargs}")
        
        # Helper function to build iptables arguments based on kwargs
        def build_args():
            args = []
            if protocol and protocol != "all":
                args.extend(["-p", protocol])
            
            # Source
            if kwargs.get('src_type') in ['single', 'network'] and kwargs.get('src_attr'):
                if kwargs.get('src_invert'): args.append("!")
                ip_src = kwargs.get('src_attr')
                if kwargs.get('src_mask') and kwargs.get('src_mask') != '32':
                    ip_src += f"/{kwargs.get('src_mask')}"
                args.extend(["-s", ip_src])
                
            if kwargs.get('sport') and protocol in ["tcp", "udp"]:
                args.extend(["--sport", str(kwargs.get('sport'))])
                
            # Destination
            if kwargs.get('dst_type') in ['single', 'network'] and kwargs.get('dst_attr'):
                if kwargs.get('dst_invert'): args.append("!")
                ip_dst = kwargs.get('dst_attr')
                if kwargs.get('dst_mask') and kwargs.get('dst_mask') != '32':
                    ip_dst += f"/{kwargs.get('dst_mask')}"
                args.extend(["-d", ip_dst])
                
            # Dport
            if port and protocol in ["tcp", "udp"]:
                args.extend(["--dport", str(port)])
                
            if states and len(states) > 0:
                args.extend(["-m", "state", "--state", ",".join(states)])
            
            return args

        # Nếu bật LOG, thêm rule LOG trước (kể cả không có port)
        if log:
            log_cmd = ["iptables"]
            priority = kwargs.get('priority')
            if priority and str(priority).isdigit():
                log_cmd.extend(["-I", chain, str(priority)])
            else:
                log_cmd.extend(["-A", chain])
                
            log_cmd.extend(build_args())
            log_prefix_val = kwargs.get('log_prefix', f"FW_LOG_{target}: ")
            log_cmd.extend(["-j", "LOG", "--log-prefix", log_prefix_val])
            subprocess.run(log_cmd, capture_output=True, check=True)

        # Rule chính
        cmd = ["iptables"]
        priority = kwargs.get('priority')
        if priority and str(priority).isdigit():
            # If log was also added, the rule priority for the actual target should shift +1 if same?
            # Or just insert at priority. If log is inserted at priority, it pushes others down.
            # Usually we insert main rule, then log rule before it, but just keeping it simple:
            if log:
                cmd.extend(["-I", chain, str(int(priority) + 1)])
            else:
                cmd.extend(["-I", chain, str(priority)])
        else:
            cmd.extend(["-A", chain])
            
        cmd.extend(build_args())
        cmd.extend(["-j", target])
        
        subprocess.run(cmd, capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logging.error(f"Lỗi thêm rule: {e}")
        return False

def delete_custom_rule(chain, protocol, port, target):
    """
    Xoá rule iptables tuỳ chỉnh theo port.
    """
    try:
        logging.info(f"Xóa rule khỏi {chain}: {protocol} port {port} -> {target}")
        cmd = ["iptables", "-D", chain, "-p", protocol, "--dport", str(port), "-j", target]
        subprocess.run(cmd, capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logging.error(f"Lỗi xóa rule: {e}")
        return False

def delete_rule_by_num(chain, num):
    """
    Xóa rule iptables theo dòng (số thứ tự).
    """
    try:
        logging.info(f"Xóa rule số {num} khỏi {chain}")
        cmd = ["iptables", "-D", chain, str(num)]
        subprocess.run(cmd, capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logging.error(f"Lỗi xóa rule số {num}: {e}")
        return False

def kill_process(pid):
    """
    Dừng process nghi ngờ bằng sudo khẩn cấp.
    """
    try:
        logging.info(f"Kill process PID: {pid}")
        subprocess.run(["kill", "-9", str(pid)], check=True)
        return True
    except subprocess.CalledProcessError:
        logging.error(f"Không thể kill PID {pid}.")
        return False
