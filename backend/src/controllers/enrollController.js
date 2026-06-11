const crypto   = require('crypto');
const { verifySync } = require('otplib');
const { PrismaClient } = require('@prisma/client');

const { PolicyError, enforcePolicy, signCsr, auditLog, CERT_VALIDITY_DAYS } =
  require('../services/enrollPolicy');

const prisma = new PrismaClient();

// ── POST /api/enroll/code  (Admin tạo enrollment code — cần OTP) ────────
exports.generateCode = async (req, res) => {
  const { otp } = req.body;
  if (!otp)
    return res.status(400).json({ error: 'otp là bắt buộc' });

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user?.twoFactorEnabled || !user?.twoFactorSecret)
    return res.status(403).json({ error: 'Admin phải bật 2FA trước khi tạo enrollment code' });

  const { valid } = verifySync({ token: otp.replace(/\s/g, ''), secret: user.twoFactorSecret });
  if (!valid)
    return res.status(401).json({ error: 'OTP không hợp lệ' });

  const code =
    'TEST-' +
    crypto.randomBytes(4).toString('hex').toUpperCase() + '-' +
    crypto.randomBytes(4).toString('hex').toUpperCase();

  await prisma.enrollmentCode.create({
    data: {
      code,
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  console.log(`[Enroll] Code tạo bởi ${user.username}: ${code}`);
  res.json({ code, expiresIn: '24h', maxUse: 1 });
};

// ── POST /api/enroll  (Agent gửi CSR + code → kiểm tra policy → tạo request) ──
exports.enroll = async (req, res) => {
  const { code, csr, hostname } = req.body;
  if (!code || !csr)
    return res.status(400).json({ error: 'Thiếu code hoặc csr' });

  // Validate CSR format
  let csrPem;
  try {
    csrPem = Buffer.from(csr, 'base64').toString('utf8');
    if (!csrPem.includes('BEGIN CERTIFICATE REQUEST')) throw new Error();
  } catch {
    return res.status(400).json({ error: 'CSR không hợp lệ (phải là base64-encoded PEM)' });
  }

  // Pre-policy check — từ chối CSR vi phạm trước khi tiêu tốn enrollment code
  try {
    enforcePolicy(csrPem);
  } catch (err) {
    if (err instanceof PolicyError)
      return res.status(422).json({ error: `Policy vi phạm: ${err.message}` });
    throw err;
  }

  // Validate enrollment code
  const record = await prisma.enrollmentCode.findUnique({ where: { code } });
  if (!record)
    return res.status(401).json({ error: 'Code không tồn tại' });
  if (record.used)
    return res.status(401).json({ error: 'Code đã được sử dụng' });
  if (new Date() > record.expiresAt)
    return res.status(401).json({ error: 'Code hết hạn' });

  const agentIp = (req.ip || '127.0.0.1').replace('::ffff:', '');

  // Đánh dấu đã dùng ngay — tránh race condition nếu 2 request cùng lúc
  await prisma.enrollmentCode.update({
    where: { code },
    data:  { used: true, usedAt: new Date(), usedByHostname: hostname || null },
  });

  const request = await prisma.enrollmentRequest.create({
    data: { hostname: hostname || null, agentIp, csr: csrPem, status: 'pending' },
  });

  console.log(`[Enroll] Pending request từ ${hostname || agentIp} — chờ admin duyệt`);
  res.status(202).json({
    requestId: request.id,
    status:    'pending',
    message:   'Yêu cầu đã ghi nhận — chờ admin phê duyệt',
  });
};

// ── GET /api/enroll/status/:requestId  (Agent polling) ───────────────────────
exports.enrollStatus = async (req, res) => {
  const request = await prisma.enrollmentRequest.findUnique({
    where: { id: req.params.requestId },
  });

  if (!request)
    return res.status(404).json({ error: 'Request không tồn tại' });

  if (request.status === 'pending')
    return res.json({ status: 'pending', message: 'Đang chờ admin phê duyệt' });

  if (request.status === 'rejected')
    return res.json({ status: 'rejected', message: 'Admin đã từ chối yêu cầu' });

  if (request.status === 'delivered')
    return res.json({ status: 'delivered', message: 'Cert đã được lấy — không còn hiệu lực' });

  if (request.status === 'approved' && request.cert) {
    const cert = request.cert;

    // One-time retrieval: xóa cert khỏi DB ngay sau khi giao
    await prisma.enrollmentRequest.update({
      where: { id: request.id },
      data:  { cert: null, status: 'delivered' },
    });

    console.log(`[Enroll] ✓ Cert giao cho ${request.hostname || request.agentIp}`);
    return res.json({ status: 'approved', cert });
    // caCert không trả về — agent đã có sẵn từ installer
  }

  res.json({ status: request.status });
};

// ── GET /api/enroll/requests  (Admin xem danh sách) ──────────────────────────
exports.listRequests = async (_req, res) => {
  const requests = await prisma.enrollmentRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, hostname: true, agentIp: true, status: true,
      createdAt: true, reviewedAt: true,
      reviewer: { select: { username: true } },
    },
  });
  res.json(requests);
};

// ── POST /api/enroll/requests/:id/approve  (Admin phê duyệt) ─────────────────
exports.approveRequest = async (req, res) => {
  const request = await prisma.enrollmentRequest.findUnique({
    where: { id: req.params.id },
  });

  if (!request)
    return res.status(404).json({ error: 'Request không tồn tại' });
  if (request.status !== 'pending')
    return res.status(409).json({ error: `Request đã ở trạng thái: ${request.status}` });

  // Policy check tại thời điểm ký (defense-in-depth)
  let cn;
  try {
    cn = enforcePolicy(request.csr);
  } catch (err) {
    if (err instanceof PolicyError) {
      await prisma.enrollmentRequest.update({
        where: { id: request.id },
        data:  { status: 'rejected', reviewedAt: new Date(), reviewedBy: req.user.userId },
      });
      console.warn(`[CEP] POLICY BLOCK | ${err.message} | host=${request.hostname} | ip=${request.agentIp}`);
      return res.status(422).json({ error: `Policy vi phạm — request tự động bị reject: ${err.message}` });
    }
    throw err;
  }

  // CA Signing
  try {
    const cert = await signCsr(request.csr, request.agentIp, request.hostname);

    await prisma.enrollmentRequest.update({
      where: { id: request.id },
      data: {
        status:     'approved',
        cert,
        reviewedAt: new Date(),
        reviewedBy: req.user.userId,
      },
    });

    auditLog(cert, {
      cn,
      hostname: request.hostname,
      agentIp:  request.agentIp,
      reviewer: req.user.username,
    });

    res.json({ ok: true, message: `Cert đã ký (${CERT_VALIDITY_DAYS} ngày) — agent sẽ nhận khi poll tiếp theo` });
  } catch (err) {
    console.error('[Enroll] Lỗi ký cert:', err.message);
    res.status(500).json({ error: 'Không ký được cert' });
  }
};

// ── POST /api/enroll/requests/:id/reject  (Admin từ chối) ────────────────────
exports.rejectRequest = async (req, res) => {
  const request = await prisma.enrollmentRequest.findUnique({
    where: { id: req.params.id },
  });

  if (!request)
    return res.status(404).json({ error: 'Request không tồn tại' });
  if (request.status !== 'pending')
    return res.status(409).json({ error: `Request đã ở trạng thái: ${request.status}` });

  await prisma.enrollmentRequest.update({
    where: { id: request.id },
    data: { status: 'rejected', reviewedAt: new Date(), reviewedBy: req.user.userId },
  });

  console.log(`[Enroll] Admin ${req.user.username} từ chối: ${request.hostname || request.agentIp}`);
  res.json({ ok: true });
};

// ── GET /api/enroll/codes  (Admin xem danh sách code) ────────────────────────
exports.listCodes = async (_req, res) => {
  const codes = await prisma.enrollmentCode.findMany({
    orderBy: { createdAt: 'desc' },
    take:    50,
    include: { creator: { select: { username: true } } },
  });
  res.json(codes);
};
