#!/usr/bin/env python3
"""
Thêm TLS cert+key thủ công cho agent.

Quy trình:
  1. Admin sinh key pair trên máy agent :
       openssl req -x509 -newkey rsa:2048 -keyout agent.key -out agent.crt \\
         -days 3650 -nodes -subj "/CN=$(hostname)/O=EDR" \\
         -addext "subjectAltName=DNS:$(hostname),IP:127.0.0.1"

  2. Chạy script này để copy vào thư mục certs:
       python add_key.py --cert agent.crt --key agent.key

  3. Thêm cert của backend để pin-verify mTLS:
       python add_key.py --cert agent.crt --key agent.key --backend-cert backend.crt

  4. Đăng ký cert+key lên backend DB qua dashboard:
       Agents → ⋮ → Manage TLS Key → Thêm Key Mới → paste nội dung cert+key
"""

import argparse
import os
import shutil
import sys

CERTS_DIR = os.path.join(os.path.dirname(__file__), 'certs')


def main():
    parser = argparse.ArgumentParser(
        description='Thêm TLS cert+key thủ công vào agent',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--cert',         required=True, help='Path tới file cert PEM của agent (agent.crt)')
    parser.add_argument('--key',          required=True, help='Path tới file private key PEM của agent (agent.key)')
    parser.add_argument('--backend-cert', default=None,  help='Path tới cert của backend để pin-verify (tuỳ chọn)')
    args = parser.parse_args()

    os.makedirs(CERTS_DIR, exist_ok=True)

    # ── Copy agent cert + key ────────────────────────────────────────────────
    for src, dest_name in [(args.cert, 'agent-cert.pem'), (args.key, 'agent-key.pem')]:
        if not os.path.exists(src):
            print(f'[Lỗi] Không tìm thấy file: {src}')
            sys.exit(1)

        dest = os.path.join(CERTS_DIR, dest_name)
        shutil.copy2(src, dest)

        if 'key' in dest_name:
            os.chmod(dest, 0o600)

        print(f'  ✓  {src}  →  {dest}')

    # ── Copy backend cert (pin-verify mTLS) ──────────────────────────────────
    if args.backend_cert:
        if not os.path.exists(args.backend_cert):
            print(f'[Lỗi] Backend cert không tìm thấy: {args.backend_cert}')
            sys.exit(1)

        dest = os.path.join(CERTS_DIR, 'backend-cert.pem')
        shutil.copy2(args.backend_cert, dest)
        print(f'  ✓  {args.backend_cert}  →  {dest}  (backend cert để pin-verify)')

    print()
    print('─' * 56)
    print(' Key đã được thêm thành công.')
    print()
    print(' Bước tiếp theo:')
    print('   Vào Dashboard → Agents → ⋮ → Manage TLS Key')
    print('   → Paste nội dung cert+key vào form để đăng ký')
    print('   với backend.')
    print('─' * 56)


if __name__ == '__main__':
    main()
