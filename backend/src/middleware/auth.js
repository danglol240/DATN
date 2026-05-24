const API_KEY = process.env.API_KEY;

/**
 * Xác thực header X-Agent-Key khớp với API_KEY trong .env.
 * Áp dụng cho toàn bộ /api — cả agent lẫn dashboard đều phải gửi key.
 */
function agentAuth(req, res, next) {
  if (!API_KEY) {
    console.warn('[AUTH] WARNING: API_KEY chưa cấu hình — bỏ qua xác thực');
    return next();
  }

  const key = req.headers['x-agent-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: X-Agent-Key không hợp lệ' });
  }

  next();
}

module.exports = { agentAuth };
