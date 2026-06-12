const jwt             = require('jsonwebtoken');
const { X509Certificate } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma     = new PrismaClient();
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

// Xác thực mTLS client cert của agent bằng cách so sánh với cert lưu trong DB.
//
// Luồng:
//   1. Lấy peer cert từ TLS socket (chỉ có nếu server.js bật requestCert: true)
//   2. Đọc agentId từ body (heartbeat/events/commands/result đều gửi agentId)
//   3. Search DB: AgentKey WHERE agentId = ?
//   4. Parse cert trong DB → lấy fingerprint256
//   5. So sánh với fingerprint256 của cert agent vừa trình
//   6. Không khớp → 401; Không có peer cert hoặc chưa đăng ký → bỏ qua (chỉ API key auth)
async function agentCertAuth(req, res, next) {
  try {
    // Chỉ chạy khi server đang ở HTTPS mode
    const peerCert = req.socket?.getPeerCertificate?.();
    if (!peerCert || !peerCert.fingerprint256) return next();

    const agentId = req.body?.agentId;
    if (!agentId) return next();

    // ── Search DB ──────────────────────────────────────────────────────────────
    const agentKey = await prisma.agentKey.findUnique({ where: { agentId } });
    if (!agentKey) return next(); // agent chưa đăng ký key → chỉ dùng API key auth

    // ── So sánh fingerprint SHA-256 ────────────────────────────────────────────
    const dbCert          = new X509Certificate(agentKey.certPem);
    const dbFingerprint   = dbCert.fingerprint256;                    // "AA:BB:CC:..."
    const peerFingerprint = peerCert.fingerprint256;

    if (peerFingerprint !== dbFingerprint) {
      console.warn(`[mTLS] REJECT agent=${agentId} fingerprint mismatch`);
      console.warn(`       presented: ${peerFingerprint}`);
      console.warn(`       expected : ${dbFingerprint}`);
      return res.status(401).json({ error: 'Unauthorized: mTLS cert không khớp với cert đã đăng ký' });
    }

    console.log(`[mTLS] ✓ agent=${agentId} cert verified`);
    next();
  } catch (err) {
    console.error('[agentCertAuth] Error:', err.message);
    next(); // lỗi parse cert → không block, để agentAuth xử lý
  }
}

module.exports = { agentAuth, agentCertAuth, dashboardAuth, requireAdmin };
