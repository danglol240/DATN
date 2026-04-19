const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { detectRules } = require('../services/ruleEngine');
const agentController = require('../controllers/agentController');
const eventController = require('../controllers/eventController');
const alertController = require('../controllers/alertController');
const commandController = require('../controllers/commandController');

const prisma = new PrismaClient();

// AGENT
router.post('/heartbeat', agentController.heartbeat);
router.get('/agents', agentController.listAgents);
router.get('/stats', agentController.getStats);

// COMMANDS (Dashboard ra lenh -> Agent thuc thi iptables)
router.post('/agents/:agentId/commands', commandController.sendCommand);
router.get('/agents/:agentId/commands', commandController.pollCommands);
router.patch('/commands/:id/done', commandController.markDone);
router.get('/agents/:agentId/commands/history', commandController.commandHistory);
router.post('/commands/batch', commandController.sendBatchCommand);

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
    for (const alert of alerts) {
      await prisma.alert.create({ data: alert });
      console.log(`[ALERT][${alert.severity}] ${alert.ruleName} - Agent: ${agentId}`);
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
