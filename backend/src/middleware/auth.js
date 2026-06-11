const jwt = require('jsonwebtoken');

const API_KEY    = process.env.API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

// JWT_SECRET bắt buộc — không fallback về hardcoded string
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET chưa được đặt trong .env');
  console.error('        Chạy: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('        rồi thêm JWT_SECRET=<kết quả> vào backend/.env');
  process.exit(1);
}

// Xác thực X-Agent-Key cho các route mà agent gọi (heartbeat, events, commands/result)
function agentAuth(req, res, next) {
  if (!API_KEY) {
    console.warn('[AUTH] WARNING: API_KEY chưa cấu hình — bỏ qua xác thực agent');
    return next();
  }

  const key = req.headers['x-agent-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: X-Agent-Key không hợp lệ' });
  }

  next();
}

// Xác thực JWT Bearer token cho các route mà dashboard gọi.
// JWT được ký bằng JWT_SECRET (HS256) — đủ bảo mật nếu secret đủ mạnh (≥48 bytes ngẫu nhiên).
// Nếu muốn chống lộ secret ở mức cao hơn: chuyển sang RS256 (asymmetric).
function dashboardAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Cần đăng nhập' });
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);

    // Reject temp token (dùng trong bước chờ 2FA) nếu lọt vào đây
    if (payload.pending2FA)
      return res.status(401).json({ error: 'Unauthorized: Cần hoàn tất xác thực 2FA' });

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Token không hợp lệ hoặc đã hết hạn' });
  }
}

// Middleware kiểm tra role admin
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Cần quyền admin' });
  }
  next();
}

module.exports = { agentAuth, dashboardAuth, requireAdmin };
