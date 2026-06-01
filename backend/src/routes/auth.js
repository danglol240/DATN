const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateSecret, verifySync, generateURI } = require('otplib');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');
const { dashboardAuth } = require('../middleware/auth');

const prisma = new PrismaClient();
const JWT_SECRET   = process.env.JWT_SECRET || 'danghoang2004';
const JWT_EXPIRES  = '24h';
const TEMP_EXPIRES = '5m'; // token tạm trong khi chờ nhập mã 2FA
const APP_NAME     = process.env.APP_NAME || 'FinalProject EDR';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function signFull(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function signTemp(userId) {
  return jwt.sign({ userId, pending2FA: true }, JWT_SECRET, { expiresIn: TEMP_EXPIRES });
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username và password là bắt buộc' });

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.status(401).json({ error: 'Sai username hoặc password' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Sai username hoặc password' });

  // Nếu 2FA đã bật → trả tempToken, client phải xác thực OTP tiếp theo
  if (user.twoFactorEnabled) {
    return res.json({
      requires2FA: true,
      tempToken: signTemp(user.id),
    });
  }

  res.json({
    token: signFull(user),
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// ─── POST /auth/verify-2fa ────────────────────────────────────────────────────
// Bước 2: dùng tempToken + mã OTP từ Google Authenticator để lấy JWT đầy đủ
router.post('/verify-2fa', async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code)
    return res.status(400).json({ error: 'tempToken và code là bắt buộc' });

  let payload;
  try {
    payload = jwt.verify(tempToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn (5 phút)' });
  }

  if (!payload.pending2FA)
    return res.status(400).json({ error: 'Token không đúng loại' });

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user?.twoFactorSecret)
    return res.status(400).json({ error: '2FA chưa được cấu hình' });

  const { valid } = verifySync({ token: code.replace(/\s/g, ''), secret: user.twoFactorSecret });
  if (!valid)
    return res.status(401).json({ error: 'Mã OTP không đúng hoặc đã hết hạn' });

  res.json({
    token: signFull(user),
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', dashboardAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─── GET /auth/2fa/setup ──────────────────────────────────────────────────────
// Tạo secret mới + QR code để quét bằng Google Authenticator
router.get('/2fa/setup', dashboardAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) return res.status(404).json({ error: 'User không tồn tại' });

  const secret = generateSecret();
  const otpauthUrl = generateURI({ label: user.username, issuer: APP_NAME, secret, type: 'totp' });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  // Lưu secret tạm (chưa enable) để dùng khi xác nhận
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: secret },
  });

  res.json({ secret, qrCodeDataUrl });
});

// ─── POST /auth/2fa/enable ────────────────────────────────────────────────────
// Xác nhận mã OTP lần đầu và bật 2FA
router.post('/2fa/enable', dashboardAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code là bắt buộc' });

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user?.twoFactorSecret)
    return res.status(400).json({ error: 'Chưa tạo secret, gọi GET /auth/2fa/setup trước' });

  const { valid } = verifySync({ token: code.replace(/\s/g, ''), secret: user.twoFactorSecret });
  if (!valid) return res.status(401).json({ error: 'Mã OTP không đúng' });

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true },
  });

  res.json({ success: true, message: '2FA đã được bật thành công' });
});

// ─── POST /auth/2fa/disable ───────────────────────────────────────────────────
// Tắt 2FA sau khi xác nhận mã OTP
router.post('/2fa/disable', dashboardAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code là bắt buộc' });

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user?.twoFactorEnabled)
    return res.status(400).json({ error: '2FA chưa được bật' });

  const { valid } = verifySync({ token: code.replace(/\s/g, ''), secret: user.twoFactorSecret });
  if (!valid) return res.status(401).json({ error: 'Mã OTP không đúng' });

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });

  res.json({ success: true, message: '2FA đã được tắt' });
});

module.exports = router;
