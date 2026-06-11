import ssl
import json
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler


def _make_handler(command_callback):
    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != '/command':
                self.send_response(404)
                self.end_headers()
                return

            # Không cần X-Backend-Key — mTLS đã xác thực danh tính backend tại TLS handshake
            length = int(self.headers.get('Content-Length', 0))
            try:
                cmd = json.loads(self.rfile.read(length))
            except Exception:
                self.send_response(400)
                self.end_headers()
                return

            # Trả 202 Accepted ngay — không chờ thực thi xong
            self.send_response(202)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"accepted"}')

            threading.Thread(target=command_callback, args=(cmd,), daemon=True).start()

        def log_message(self, *_):
            pass  # tắt HTTP access log mặc định

    return _Handler


def run_agent_server(port, cert_path, key_path, ca_cert_path, command_callback):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_path, key_path)

    # mTLS: yêu cầu backend phải trình client cert được ký bởi CA chung
    if ca_cert_path:
        ctx.verify_mode = ssl.CERT_REQUIRED
        ctx.load_verify_locations(ca_cert_path)
        logging.info(f'[AgentServer] mTLS enabled — verify client cert via {ca_cert_path}')
    else:
        logging.warning('[AgentServer] ca_cert không cấu hình — bỏ qua verify client cert')

    srv = HTTPServer(('0.0.0.0', port), _make_handler(command_callback))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)

    logging.info(f'[AgentServer] HTTPS listening on :{port}')
    srv.serve_forever()
