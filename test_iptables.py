import subprocess
try:
    res = subprocess.run(["iptables", "-L", "-n", "--line-numbers"], capture_output=True, text=True)
    print("STDOUT:", repr(res.stdout))
    print("STDERR:", repr(res.stderr))
except Exception as e:
    print("ERR:", e)
