#!/usr/bin/env bash
# Tạo traffic test qua virsh console để MINH HOẠ TRỰC TIẾP trên Wireshark GUI
# (khác với 06-capture-verify.sh — script đó tự bắt bằng tcpdump, script này
# không capture gì cả, chỉ sinh traffic trong lúc bạn đang capture bằng tay).
#
# Cách dùng:
#   1. Mở Wireshark GUI, ở màn hình chọn interface: giữ Ctrl, click chọn cả
#      3 interface  vbr-dmz + vbr-lan + virbr0  → bấm nút cá mập xanh để Start.
#   2. Chạy script này (không cần sudo, virsh console không cần root).
#   3. Xem gói tin chảy trực tiếp trong Wireshark, dừng capture khi xong.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
require_cmd virsh
require_cmd python3

console_run() {
  local vm="$1"; shift
  python3 - "$vm" "$@" <<'PYEOF'
import pty, os, time, select, sys

vm = sys.argv[1]
cmds = sys.argv[2:]

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid(); os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2); os.close(master)
    os.execvp("virsh", ["virsh", "console", vm])
os.close(slave)

def send(s):
    os.write(master, s.encode())

def read_for(seconds):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.3)
        if master in r:
            try:
                chunk = os.read(master, 65536)
                if chunk:
                    sys.stdout.write(chunk.decode(errors="replace"))
                    sys.stdout.flush()
            except OSError:
                break

send("\r\n"); read_for(2)
send("\r\n"); read_for(2)
send("ubuntu\n"); read_for(3)
send("edrlab123\n"); read_for(3)
for c in cmds:
    send(c + "\n")
    read_for(7)
send("\x1d")
time.sleep(0.3)
try:
    os.kill(pid, 9)
except ProcessLookupError:
    pass
PYEOF
}

log "Đảm bảo Wireshark GUI ĐÃ bấm Start capture trên vbr-dmz + vbr-lan + virbr0."
read -rp "  → Enter để bắt đầu sinh traffic test... "

log "[1/3] agent-dmz-01 → ping agent-lan-01 (10.10.30.11) — kỳ vọng: KHÔNG có reply (bị chặn)"
console_run agent-dmz-01 "ping -c4 -W2 10.10.30.11"

log "[2/3] agent-lan-01 → ping agent-dmz-01 (10.10.20.11) — kỳ vọng: KHÔNG có reply (bị chặn)"
console_run agent-lan-01 "ping -c4 -W2 10.10.20.11"

log "[3/3] agent-dmz-01 → ping 8.8.8.8 — đối chứng, kỳ vọng: CÓ reply (WAN vẫn thông)"
console_run agent-dmz-01 "ping -c4 -W2 8.8.8.8"

cat <<'EOF'

── xong, dừng capture trong Wireshark rồi lọc ──────────────────────
Trên vbr-dmz  : icmp && ip.dst == 10.10.30.11     → thấy request rời đi, không có reply
Trên vbr-lan  : icmp && ip.src == 10.10.20.11     → không có gói nào cả (bằng chứng bị chặn)
Trên virbr0   : icmp && ip.dst == 8.8.8.8         → thấy round-trip bình thường (đối chứng)
Trên virbr0   : tls.handshake.type == 11          → thấy mTLS Certificate (agent heartbeat)
EOF
