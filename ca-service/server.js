'use strict';
/**
 * CA Signing Service
 *
 * Service độc lập chỉ làm một việc: nhận CSR → ký bằng CA key → trả cert.
 * Backend KHÔNG giữ ca-key.pem — chỉ CA service mới có.
 *
 * Bảo mật:
 *   - Chỉ lắng nghe trên 127.0.0.1 (localhost), không ra ngoài internet
 *   - Xác thực bằng X-CA-Token header (shared secret, đặt trong .env)
 *
 * API:
 *   POST /sign
 *     Body: { csr: "<PEM>", agentIp: "...", hostname: "..." }
 *     → { cert: "<PEM>" }
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PORT     = parseInt(process.env.PORT || '8888', 10);
const CA_TOKEN = process.env.CA_TOKEN;
const CERTS    = path.resolve(process.env.CERTS_DIR || './certs');
const VALIDITY = Math.min(parseInt(process.env.CERT_VALIDITY_DAYS || '365', 10), 365);

if (!CA_TOKEN) {
  console.error('[FATAL] CA_TOKEN chưa được đặt — thêm CA_TOKEN vào ca-service/.env');
  process.exit(1);
}

// ── Signing ───────────────────────────────────────────────────────────────────

function signCsr(csrPem, agentIp, hostname) {
  const uid      = crypto.randomBytes(8).toString('hex');
  const csrPath  = `/tmp/${uid}.csr`;
  const certPath = `/tmp/${uid}.crt`;
  const extPath  = `/tmp/${uid}.ext`;

  try {
    fs.writeFileSync(csrPath, csrPem);
    fs.writeFileSync(extPath, [
      `subjectAltName=IP:${agentIp},IP:127.0.0.1,DNS:${hostname || 'edr-agent'}`,
      `extendedKeyUsage=clientAuth`,
      `keyUsage=digitalSignature`,
    ].join('\n') + '\n');

    execFileSync('openssl', [
      'x509', '-req',
      '-days',    String(VALIDITY),
      '-in',      csrPath,
      '-CA',      path.join(CERTS, 'ca-cert.pem'),
      '-CAkey',   path.join(CERTS, 'ca-key.pem'),
      '-CAcreateserial',
      '-extfile', extPath,
      '-out',     certPath,
    ]);

    return fs.readFileSync(certPath, 'utf8');
  } finally {
    for (const f of [csrPath, certPath, extPath])
      try { fs.unlinkSync(f); } catch {}
  }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', chunk => buf += chunk);
    req.on('end',  () => resolve(buf));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.headers['x-ca-token'] !== CA_TOKEN)
    return reply(401, { error: 'Unauthorized' });

  if (req.method !== 'POST' || req.url !== '/sign')
    return reply(404, { error: 'Not found' });

  try {
    const { csr, agentIp, hostname } = JSON.parse(await readBody(req));
    if (!csr) return reply(400, { error: 'csr là bắt buộc' });

    const cert = signCsr(csr, agentIp || '127.0.0.1', hostname || 'edr-agent');
    console.log(`[CA] Đã ký cert cho ${hostname || agentIp}`);
    reply(200, { cert });
  } catch (err) {
    console.error('[CA] Lỗi ký cert:', err.message);
    reply(500, { error: 'Không ký được cert' });
  }
});

// Chỉ bind localhost — không cho phép kết nối từ ngoài
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[CA Service] Listening on 127.0.0.1:${PORT}`);
  console.log(`[CA Service] CERTS: ${CERTS}`);
  console.log(`[CA Service] Validity: ${VALIDITY} ngày`);
});
