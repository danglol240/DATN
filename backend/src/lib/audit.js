const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

async function logAudit(req, action, resource = null, detail = null, outcome = 'success') {
  try {
    await prisma.auditLog.create({
      data: {
        username: req.user?.username || 'anonymous',
        role:     req.user?.role     || 'unknown',
        action,
        resource,
        detail,
        ip:      getIp(req),
        outcome,
      },
    });
  } catch (err) {
    console.error('[AuditLog] Failed to write:', err.message);
  }
}

module.exports = { logAudit };
