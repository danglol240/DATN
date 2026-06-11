/**
 * Certificate Enrollment Policy (CEP)
 *
 * Tách biệt hoàn toàn khỏi controller — Policy Engine quyết định
 * khi nào được phép cấp cert; việc ký thực tế do CA Service đảm nhiệm.
 *
 * Luồng:
 *   enroll()       → enforcePolicy()  (pre-check tại submission)
 *   approveRequest → enforcePolicy() → signCsr() → auditLog()
 *
 * Backend KHÔNG giữ ca-key.pem — chỉ gọi CA Service qua HTTP nội bộ.
 */

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const { execFileSync } = require('child_process');

const CERT_VALIDITY_DAYS = Math.min(
  parseInt(process.env.CERT_VALIDITY_DAYS || '365', 10),
  365,
);

const CN_BLACKLIST = [
  'backend', 'server', 'ca', 'root', 'root-ca', 'issuing-ca',
  'administrator', 'admin', 'localhost', 'gateway', 'proxy',
];

class PolicyError extends Error {}

// ── Policy ─────────────────────────────────────────────────────────────────────

function parseCsrCn(csrPem) {
  try {
    const out = execFileSync(
      'openssl', ['req', '-in', '/dev/stdin', '-noout', '-subject'],
      { input: csrPem },
    ).toString();
    const m = out.match(/CN\s*=\s*([^,/\n]+)/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function enforcePolicy(csrPem) {
  const cn = parseCsrCn(csrPem);
  if (!cn)
    throw new PolicyError('CSR không có Common Name (CN)');

  const lower = cn.toLowerCase();

  if (CN_BLACKLIST.some(b => lower === b || lower.includes(b)))
    throw new PolicyError(`CN "${cn}" không được phép — chỉ cấp cert cho agent thường`);

  if (!lower.startsWith('edr-'))
    throw new PolicyError(`CN "${cn}" phải bắt đầu bằng "edr-" (ví dụ: edr-agent-PC001)`);

  return cn;
}

// ── CA Service client ──────────────────────────────────────────────────────────

function _post(url, token, body) {
  return new Promise((resolve, reject) => {
    const raw  = JSON.stringify(body);
    const opts = {
      method:   'POST',
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(raw),
        'X-CA-Token':     token,
      },
    };

    const req = http.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`CA Service lỗi ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('CA Service trả về JSON không hợp lệ'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('CA Service timeout')); });
    req.write(raw);
    req.end();
  });
}

async function signCsr(csrPem, agentIp, hostname) {
  const caUrl   = new URL(process.env.CA_SERVICE_URL || 'http://127.0.0.1:8888');
  const caToken = process.env.CA_TOKEN;

  if (!caToken)
    throw new Error('CA_TOKEN chưa được cấu hình trong backend .env');

  const { cert } = await _post(
    new URL('/sign', caUrl),
    caToken,
    { csr: csrPem, agentIp, hostname },
  );

  if (!cert)
    throw new Error('CA Service không trả về cert');

  return cert;
}

// ── Audit Trail ────────────────────────────────────────────────────────────────

function auditLog(certPem, { cn, hostname, agentIp, reviewer }) {
  try {
    const uid      = crypto.randomBytes(4).toString('hex');
    const certPath = `/tmp/${uid}-audit.crt`;
    fs.writeFileSync(certPath, certPem);

    const serial = execFileSync(
      'openssl', ['x509', '-in', certPath, '-noout', '-serial'],
    ).toString().trim().split('=')[1];

    const fingerprint = execFileSync(
      'openssl', ['x509', '-in', certPath, '-noout', '-fingerprint', '-sha256'],
    ).toString().trim().split('=')[1];

    fs.unlinkSync(certPath);

    console.log(
      `[CEP Audit] ISSUED | CN=${cn} | Serial=${serial} | ` +
      `Fingerprint=${fingerprint} | host=${hostname || '-'} | ip=${agentIp} | ` +
      `by=${reviewer} | validity=${CERT_VALIDITY_DAYS}d`,
    );
  } catch (e) {
    console.error('[CEP Audit] Không lấy được serial/fingerprint:', e.message);
  }
}

module.exports = { PolicyError, enforcePolicy, signCsr, auditLog, CERT_VALIDITY_DAYS };
