import ssl
import json
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler


def _make_handler(api_secret, command_callback):
    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != '/command':
                self.send_response(404)
                self.end_headers()
                return

            if self.headers.get('X-Backend-Key', '') != api_secret:
                logging.warning(f'[AgentServer] 401 từ {self.client_address[0]}')
                self.send_response(401)
                self.end_headers()
                return

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


def run_agent_server(port, cert_path, key_path, api_secret, command_callback):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_path, key_path)

    srv = HTTPServer(('0.0.0.0', port), _make_handler(api_secret, command_callback))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)

    logging.info(f'[AgentServer] HTTPS listening on :{port}')
    srv.serve_forever()
