import hmac
import hashlib


class SecurityError(Exception):
    pass


def verify_and_extract_command(cmd: dict, api_secret: str) -> dict:
    """
    Verify HMAC-SHA256 signature của command trước khi thực thi.

    Payload phải khớp với backend/src/lib/security.js:
      id:agentId:action:params

    Raises SecurityError nếu signature vắng mặt hoặc không hợp lệ.
    Returns command dict (không có trường signature) nếu hợp lệ.
    """
    if not api_secret:
        raise SecurityError("api_key chưa được cấu hình — không thể verify")

    signature = cmd.get('signature')
    if not signature:
        raise SecurityError("Thiếu trường 'signature' trong command")

    params = cmd.get('params', '{}')
    if not isinstance(params, str):
        import json
        params = json.dumps(params)

    payload = f"{cmd.get('id')}:{cmd.get('agentId')}:{cmd.get('action')}:{params}"
    expected = hmac.new(api_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(signature, expected):
        raise SecurityError("Signature không hợp lệ")

    return cmd
