const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/audit-logs?username=&action=&outcome=&from=&to=&limit=&offset=
exports.listAuditLogs = async (req, res) => {
  try {
    const { username, action, outcome, from, to, limit = 100, offset = 0 } = req.query;

    const where = {};
    if (username) where.username = { contains: username, mode: 'insensitive' };
    if (action)   where.action   = { contains: action,   mode: 'insensitive' };
    if (outcome)  where.outcome  = outcome;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to)   where.timestamp.lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take:    parseInt(limit),
        skip:    parseInt(offset),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total });
  } catch (err) {
    console.error('[AuditLog] listAuditLogs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/audit-logs/export  — tải CSV
exports.exportCsv = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to)   where.timestamp.lte = new Date(to);
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 50000,
    });

    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'timestamp,username,role,action,resource,detail,ip,outcome';
    const rows   = logs.map(l => [
      l.timestamp.toISOString(),
      l.username,
      l.role,
      l.action,
      l.resource || '',
      l.detail   || '',
      l.ip       || '',
      l.outcome,
    ].map(escape).join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${Date.now()}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    console.error('[AuditLog] exportCsv error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
