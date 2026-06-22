const { PrismaClient } = require('@prisma/client');
const { logAudit } = require('../lib/audit');
const prisma = new PrismaClient();

// GET /api/alerts - Dashboard đọc danh sách alert
exports.listAlerts = async (req, res) => {
  try {
    const { severity, resolved = 'false', limit = 50 } = req.query;
    
    let whereClause = { ...(severity && { severity }) };
    if (resolved !== 'all') {
      whereClause.resolved = resolved === 'true';
    }

    const alerts = await prisma.alert.findMany({
      where: whereClause,
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit),
      include: { agent: { select: { hostname: true, ip: true } } }
    });
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PATCH /api/alerts/:id/resolve - đánh dấu đã giải quyết
exports.resolveAlert = async (req, res) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: { resolved: true }
    });
    await logAudit(req, 'ALERT_RESOLVE', `alert:${req.params.id}`, `rule=${alert.ruleName}`, 'success');
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
