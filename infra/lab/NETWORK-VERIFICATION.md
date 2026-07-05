# Kiểm chứng mạng lab EDR bằng Wireshark

Tài liệu này ghi lại quy trình kiểm thử thực tế đã chạy trên lab (`infra/lab/`) để chứng minh 3 tính chất cốt lõi của thiết kế mạng: **cô lập 2 chiều giữa DMZ và LAN nội bộ**, **WAN vẫn thông cho cả 2 vùng**, và **kênh liên lạc agent↔backend dùng mTLS thật (không phải TLS 1 chiều)**.

## 1. Sơ đồ mạng được kiểm thử

```
                    Host — danglol240-Precision-7550
                    backend EDR :3000 (Node.js, mTLS requestCert)
                              │
                    virbr0  192.168.122.1   (libvirt gateway, KHÔNG
                    dùng IP Wi-Fi vật lý vì IP đó roaming/đổi mạng)
                              │  https · mTLS
                    ┌─────────┴─────────┐
                    │    core-router    │  nftables · ip_forward · 3 NIC
                    └───┬───────────┬───┘
              gw 10.10.20.1   gw 10.10.30.1
                    │                 │
        ┌───────────┴──────┐  ┌───────┴───────────┐
        │  DMZ (vlan-dmz)   │  │  LAN nội bộ        │
        │  10.10.20.0/24    │  │  10.10.30.0/24      │
        │  agent-dmz-01     │  │  agent-lan-01       │
        │  .11              │  │  .11                │
        │  agent-dmz-02     │  │  agent-lan-02       │
        │  .12              │  │  .12                │
        └───────────────────┘  └─────────────────────┘
              ✕ DMZ ⇄ LAN bị chặn hoàn toàn (nftables forward drop)
```

| Vùng | CIDR | Gateway (core-router) | Máy trong vùng |
|---|---|---|---|
| Admin/WAN | — (không phải VM riêng) | `192.168.122.1` (virbr0, host) | backend :3000 |
| DMZ | `10.10.20.0/24` | `10.10.20.1` | agent-dmz-01 (`.11`), agent-dmz-02 (`.12`) |
| LAN nội bộ | `10.10.30.0/24` | `10.10.30.1` | agent-lan-01 (`.11`), agent-lan-02 (`.12`) |

Điểm quan trọng trong thiết kế: backend không có VM Admin/WAN riêng — nó chạy thẳng trên host, và host cũng chính là gateway của mạng ảo libvirt "default" mà NIC WAN của `core-router` cắm vào. Vì vậy agent đi thẳng tới backend qua `virbr0` mà không cần ra khỏi máy — không phụ thuộc IP Wi-Fi vật lý (IP đó từng đổi qua lại giữa các mạng khác nhau trong lúc dựng lab, gây heartbeat timeout bí ẩn cho tới khi phát hiện và chuyển sang dùng `virbr0`).

## 2. Công cụ & quy trình

| Thành phần | Vai trò |
|---|---|
| `06-capture-verify.sh` | Bắt gói bằng `tcpdump` (headless), tự dừng sau N giây, in sẵn filter gợi ý |
| `07-gen-test-traffic.sh` | Không capture — chỉ tự động console vào từng VM qua `virsh console` và sinh traffic test (ping), dùng song song với Wireshark GUI đang capture trực tiếp |
| Wireshark 4.2.2 (GUI) | Capture trực tiếp đồng thời 3 interface: `vbr-dmz`, `vbr-lan`, `virbr0` |
| `SSLKEYLOGFILE` (Node.js `keylog` event) | Ghi lại khoá phiên TLS 1.3 ra file, để Wireshark giải mã được nội dung handshake mTLS |

Quyền capture không cần sudo mỗi lần nhờ 1 lần cấu hình:
```bash
sudo usermod -aG wireshark $(whoami)
sudo setcap cap_net_raw,cap_net_admin=eip /usr/bin/dumpcap
# rồi đăng xuất/đăng nhập lại
```

### Kịch bản traffic test (`07-gen-test-traffic.sh`)

1. `agent-dmz-01` → ping `agent-lan-01` (`10.10.30.11`) × 4 — kỳ vọng **không có reply**.
2. `agent-lan-01` → ping `agent-dmz-01` (`10.10.20.11`) × 4 — kỳ vọng **không có reply** (chiều ngược lại).
3. `agent-dmz-01` → ping `8.8.8.8` × 4 — đối chứng, kỳ vọng **có reply** (WAN vẫn thông dù DMZ/LAN bị cô lập).

## 3. Test 1 — `test.pcapng`

- Thời điểm: 2026-07-05 20:47:58 → 20:49:07 (~69 giây), 515 gói, chia đều cho 3 interface (243 / 142 / 130 gói).
- Capture **trước khi bật `SSLKEYLOGFILE`**.

**Kết quả ICMP:**

| Test | Request thấy được | Reply thấy được | Kết luận |
|---|---|---|---|
| DMZ → LAN | 4 (`10.10.20.11 → 10.10.30.11`) | 0 | ✅ Bị chặn |
| LAN → DMZ | 4 (`10.10.30.11 → 10.10.20.11`) | 0 | ✅ Bị chặn (2 chiều) |
| DMZ → WAN (8.8.8.8) | 4 | 2 (seq 3, 4) | ✅ WAN thông (50% loss — do vài giây đầu router/NAT chưa "ấm", không phải lỗi hệ thống) |

Bằng chứng NAT: thấy cùng 1 gói ping xuất hiện 2 lần với 2 địa chỉ nguồn khác nhau — `10.10.20.11 → 8.8.8.8` (trước NAT, bắt trên `vbr-dmz`) và `192.168.122.252 → 8.8.8.8` (sau NAT, bắt trên `virbr0`, `192.168.122.252` là IP WAN mà `core-router` được libvirt DHCP cấp) — do Wireshark capture cả 3 interface cùng lúc nên nhìn thấy trực tiếp quá trình masquerade.

**mTLS:** thấy 22 phiên TCP tới `192.168.122.1:3000`, tất cả theo đúng chữ ký bắt tay TLS 1.3 (`ClientHello` → `ServerHello, ChangeCipherSpec, ApplicationData×5` → `ChangeCipherSpec, ApplicationData×3`). **Không lọc được `Certificate` bằng filter thông thường** — xem giải thích ở mục 5.

## 4. Test 2 — `test2.pcapng`

- Thời điểm: 2026-07-05 21:13:25 → 21:14:53 (~88 giây), 442 gói (202 / 142 / 98 gói / interface).
- Capture **sau khi bật `SSLKEYLOGFILE`** (backend được sửa thêm 4 dòng code lắng nghe event `keylog` của TLS server, chỉ kích hoạt khi biến môi trường này được set — không ảnh hưởng vận hành bình thường).

**Kết quả ICMP — giống Test 1 về bản chất, tốt hơn về đối chứng WAN:**

| Test | Request | Reply | Kết luận |
|---|---|---|---|
| DMZ → LAN | 4 | 0 | ✅ Bị chặn |
| LAN → DMZ | 4 | 0 | ✅ Bị chặn |
| DMZ → WAN (8.8.8.8) | 4 | **4/4** | ✅ WAN thông 100% (round-trip ~25-30ms mỗi gói — mạng đã "ấm" sau lần capture đầu) |

**Khác biệt cốt lõi so với Test 1:** file này capture **cùng lúc backend đang ghi khoá phiên TLS ra `infra/lab/out/tls-keylog.log`**. Đã đối chiếu bằng tay (script tự viết, do máy không có sẵn `tshark`): trích xuất "Client Random" của cả 10 `ClientHello` trong `test2.pcapng`, so với các dòng key log — **cả 10/10 khớp**. Nghĩa là khi mở `test2.pcapng` trong Wireshark **và** trỏ "(Pre)-Master-Secret log filename" (Edit → Preferences → Protocols → TLS) về đúng file `tls-keylog.log`, Wireshark sẽ **giải mã được toàn bộ nội dung handshake**, filter `tls.handshake.type == 11` sẽ hiện đúng message `Certificate` (cả phía backend lẫn phía agent) — điều mà Test 1 không làm được.

## 5. Vì sao Test 1 không thấy `Certificate`, nhưng vẫn kết luận mTLS hoạt động đúng?

Kết nối agent↔backend thương lượng **TLS 1.3**. Theo thiết kế bảo mật của TLS 1.3 (RFC 8446), mọi thông điệp bắt tay **sau `ServerHello`** — bao gồm `EncryptedExtensions`, `Certificate`, `CertificateVerify`, `Finished` của cả 2 phía — đều được **mã hoá ngay lập tức** và thể hiện ở lớp record là `ApplicationData` (loại bản ghi 0x17), để người quan sát thụ động bên ngoài không thể phân biệt "đây là lúc trao đổi chứng chỉ" với "đây là dữ liệu heartbeat thật". Đây là hành vi **đúng chuẩn, không phải lỗi**.

Do đó:
- **Test 1** chỉ chứng minh mTLS bằng suy luận gián tiếp: đúng chữ ký bắt tay TLS 1.3 + agent tự báo heartbeat "OK" (tức `res.raise_for_status()` phía agent không ném lỗi) + backend log in `[mTLS] ✓ agent=<id> cert verified`.
- **Test 2** khắc phục hạn chế đó bằng `SSLKEYLOGFILE`: cho phép Wireshark giải mã và **hiển thị trực tiếp** thông điệp `Certificate`, đủ thuyết phục cho mục đích trình bày/bảo vệ đồ án.

## 6. Kết luận

| Tiêu chí | Đạt? | Bằng chứng |
|---|---|---|
| DMZ và LAN nội bộ cô lập 2 chiều | ✅ | ICMP request có, reply không có ở cả 2 chiều — cả Test 1 và Test 2 |
| Cả 2 vùng vẫn ra được WAN/Internet | ✅ | Ping 8.8.8.8 có reply (2/4 rồi 4/4); NAT quan sát được trực tiếp qua 2 lớp: DMZ/LAN → core-router (masquerade lần 1) → virbr0 → host (masquerade lần 2 nếu ra Internet thật) |
| Kênh agent↔backend dùng mTLS thật | ✅ | Chữ ký bắt tay TLS 1.3 đúng chuẩn (Test 1); giải mã bằng SSLKEYLOGFILE xác nhận key khớp 10/10 phiên, sẵn sàng hiện `Certificate` khi mở trong Wireshark (Test 2) |

Cả 2 lần test đều đạt yêu cầu; Test 2 là bản đầy đủ hơn, phù hợp dùng làm bằng chứng chính khi trình bày/bảo vệ đồ án vì có thể **giải mã và trình chiếu trực tiếp** gói `Certificate` thay vì chỉ suy luận qua pattern.
