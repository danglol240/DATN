import os
import time
import base64
import logging
import subprocess
import requests


CERTS_DIR = './certs'

_KEY_PATH  = f'{CERTS_DIR}/agent-key.pem'
_CERT_PATH = f'{CERTS_DIR}/agent-cert.pem'
_CA_PATH   = f'{CERTS_DIR}/ca-cert.pem'

POLL_INTERVAL = 5    # giây giữa mỗi lần poll
POLL_TIMEOUT  = 600  # tối đa 10 phút chờ admin duyệt


def is_enrolled() -> bool:
    """
    CA (ca-cert.pem) được đóng gói sẵn trong installer — không cần tải.
    Chỉ kiểm tra key và cert riêng của agent.
    """
    if not os.path.exists(_CA_PATH):
        raise RuntimeError(
            f'ca-cert.pem không tồn tại tại {_CA_PATH}.\n'
            'CA cert phải được đóng gói sẵn trong installer — liên hệ admin.'
        )
    return all(os.path.exists(p) for p in [_KEY_PATH, _CERT_PATH])


def _run(cmd: list):
    subprocess.run(cmd, check=True, capture_output=True)


def _prompt_code() -> str:
    """Luôn yêu cầu admin nhập code thủ công — không đọc từ config hay file."""
    print()
    print('─' * 56)
    print(' Enrollment: agent chưa có cert TLS')
    print(' Admin cần tạo code tại dashboard:')
    print('   Dashboard → Enrollment → "Tạo Code" → nhập OTP')
    print('─' * 56)
    code = input(' Enrollment Code (EDR-XXXX-XXXX): ').strip()
    print('─' * 56)
    return code


def enroll(backend_url: str, hostname: str):
    """
    Enrollment lần đầu:
      1. Nhập code thủ công (luôn hỏi — không từ config)
      2. Sinh private key tại chỗ — không rời máy
      3. Tạo CSR → gửi kèm code → nhận requestId
         (TLS verify qua ca-cert.pem đã đóng gói sẵn — không có verify=False)
      4. Poll backend cho đến khi admin approve hoặc reject
      5. Lưu agent-cert.pem
    """
    os.makedirs(CERTS_DIR, exist_ok=True)

    # CA phải có sẵn — đóng gói trong installer
    if not os.path.exists(_CA_PATH):
        raise RuntimeError(
            f'ca-cert.pem không tồn tại tại {_CA_PATH}.\n'
            'CA cert phải được đóng gói sẵn trong installer — liên hệ admin.'
        )

    # ── 1. Admin nhập code thủ công ─────────────────────────────────────────
    code = _prompt_code()
    if not code:
        raise RuntimeError('Không có enrollment code — hủy')

    # ── 2. Sinh private key tại chỗ (không bao giờ rời máy) ─────────────────
    logging.info('[Enroll] Sinh private key...')
    _run(['openssl', 'genrsa', '-out', _KEY_PATH, '2048'])
    os.chmod(_KEY_PATH, 0o600)

    # ── 3. Tạo CSR ───────────────────────────────────────────────────────────
    logging.info('[Enroll] Tạo CSR...')
    csr_path = '/tmp/agent-enroll.csr'
    _run([
        'openssl', 'req', '-new',
        '-key',  _KEY_PATH,
        '-out',  csr_path,
        '-subj', f'/CN=edr-agent-{hostname}/O=EDR/C=VN',
    ])

    with open(csr_path, 'rb') as f:
        csr_b64 = base64.b64encode(f.read()).decode()
    os.unlink(csr_path)

    # ── 4. Gửi CSR + code lên backend (verify TLS qua CA đã có sẵn) ─────────
    logging.info('[Enroll] Gửi yêu cầu enrollment...')
    res = requests.post(
        f'{backend_url}/api/enroll',
        json={'code': code, 'csr': csr_b64, 'hostname': hostname},
        verify=_CA_PATH,
        timeout=15,
    )

    # Xóa code khỏi bộ nhớ ngay sau khi gửi
    del code

    if res.status_code == 400:
        raise RuntimeError(f'Lỗi dữ liệu: {res.json().get("error")}')
    if res.status_code == 401:
        raise RuntimeError(f'Code không hợp lệ hoặc đã dùng: {res.json().get("error")}')
    if res.status_code not in (200, 202):
        raise RuntimeError(f'Server lỗi ({res.status_code}): {res.json().get("error")}')

    request_id = res.json()['requestId']
    logging.info(f'[Enroll] ✓ Yêu cầu ghi nhận (ID: {request_id[:8]}…)')
    logging.info('[Enroll] Đang chờ admin phê duyệt…')

    # ── 5. Poll cho đến khi admin approve / reject / timeout ─────────────────
    poll_url = f'{backend_url}/api/enroll/status/{request_id}'
    deadline = time.time() + POLL_TIMEOUT
    dots     = 0

    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        dots += 1
        print(f'\r[Enroll] Chờ admin duyệt{"." * (dots % 4)}   ', end='', flush=True)

        try:
            poll = requests.get(poll_url, verify=_CA_PATH, timeout=10)
        except Exception:
            continue

        if poll.status_code != 200:
            continue

        data   = poll.json()
        status = data.get('status')

        if status == 'pending':
            continue

        print()  # xuống dòng sau dấu chấm

        if status == 'rejected':
            for p in [_KEY_PATH]:
                try: os.unlink(p)
                except: pass
            raise RuntimeError('Admin đã từ chối yêu cầu enrollment')

        if status == 'approved':
            with open(_CERT_PATH, 'w') as f:
                f.write(data['cert'])

            logging.info('[Enroll] ✓ Enrollment hoàn tất!')
            logging.info(f'  key  → {_KEY_PATH}')
            logging.info(f'  cert → {_CERT_PATH}')
            logging.info(f'  ca   → {_CA_PATH}  (bundled)')
            return

    print()
    raise RuntimeError(f'Timeout sau {POLL_TIMEOUT}s — admin chưa duyệt. Thử lại sau.')
