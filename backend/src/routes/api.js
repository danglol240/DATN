const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { detectRules } = require('../services/ruleEngine');
const agentController = require('../controllers/agentController');
const eventController = require('../controllers/eventController');
const alertController = require('../controllers/alertController');
const commandController = require('../controllers/commandController');
const { processResult }  = require('../lib/resultConsumer');
const { agentAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// Xác thực X-Agent-Key cho toàn bộ /api
router.use(agentAuth);

// AGENT
router.post('/heartbeat', agentController.heartbeat);
router.get('/agents', agentController.listAgents);
router.get('/stats', agentController.getStats);

// COMMANDS — Dashboard gửi lệnh; agent nhận qua HTTPS push, kết quả về qua HTTP hoặc Redis.
router.post('/agents/:agentId/commands', commandController.sendCommand);
router.get('/agents/:agentId/commands/history', commandController.commandHistory);
router.post('/commands/batch', commandController.sendBatchCommand);

// Kết quả lệnh từ agent gửi thẳng về qua HTTP (primary path).
// Nếu agent không reach được backend, fallback RPUSH results:queue → BLPOP consumer xử lý.
router.post('/commands/result', async (req, res) => {
  const { commandId, agentId, status, result } = req.body;
  if (!commandId || !agentId || !status)
    return res.status(400).json({ error: 'commandId, agentId, status là bắt buộc' });

  try {
    const io = req.app.get('io');
    await processResult(io, { commandId, agentId, status, result });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Result HTTP] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// EVENTS (Agent gui len + Rule Engine tu dong)
router.post('/events', async (req, res) => {
  try {
    const { agentId, type, data } = req.body;
    if (!agentId || !type)
      return res.status(400).json({ error: 'agentId va type la bat buoc' });

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    const agentConfig = agent?.rulesConfig ? JSON.parse(agent.rulesConfig) : {};
    const event = await prisma.event.create({
      data: { agentId, type, data: data || '{}' },
    });

    const alerts = detectRules({ ...event }, agentConfig);
    const io = req.app.get('io');

    for (const alert of alerts) {
      const createdAlert = await prisma.alert.create({ data: alert });
      console.log(`[ALERT][${alert.severity}] ${alert.ruleName} - Agent: ${agentId}`);

      // Broadcast to all connected dashboard clients in real-time
      if (io) {
        io.to('dashboards').emit('alert_notification', {
          alert: { ...createdAlert, agentHostname: agent?.hostname },
        });
      }
    }

    res.status(201).json({ event, alertsGenerated: alerts.length });
  } catch (error) {
    console.error('Ingest error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/events', eventController.listEvents);

// ALERTS
router.get('/alerts', alertController.listAlerts);
router.patch('/alerts/:id/resolve', alertController.resolveAlert);


// RULES CONFIG
const { RULES } = require('../services/ruleEngine');
router.get('/agents/:agentId/rules', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.agentId } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  let config = {};
  if (agent.rulesConfig) {
    try { config = JSON.parse(agent.rulesConfig); } catch(e){}
  }
  const enrichedRules = RULES.map(r => ({
    id: r.id, name: r.name, severity: r.severity,
    enabled: config[r.id] !== false
  }));
  res.json({ rules: enrichedRules });
});

router.post('/agents/:agentId/rules', async (req, res) => {
  const { config } = req.body;
  await prisma.agent.update({
    where: { id: req.params.agentId },
    data: { rulesConfig: JSON.stringify(config) }
  });
  res.json({ success: true });
});

module.exports = router;
