const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// POST /api/events - Agent gửi event lên
exports.ingestEvent = async (req, res) => {
  try {
    const { agentId, type, data } = req.body;
    if (!agentId || !type) {
      return res.status(400).json({ error: 'agentId và type là bắt buộc' });
    }
    const event = await prisma.event.create({
      data: { agentId, type, data: data || '{}' }
    });
    console.log(`[EVENT] Agent ${agentId} - Type: ${type}`);
    res.status(201).json(event);
  } catch (error) {
    console.error('Lỗi ingest event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/events - Dashboard đọc danh sách event
exports.listEvents = async (req, res) => {
  try {
    const { agentId, type, limit = 50 } = req.query;
    const events = await prisma.event.findMany({
      where: {
        ...(agentId && { agentId }),
        ...(type && { type }),
      },
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit),
      include: { agent: { select: { hostname: true, ip: true } } }
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
