const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { detectRules } = require('../services/ruleEngine');
const agentController  = require('../controllers/agentController');
const eventController  = require('../controllers/eventController');
const alertController  = require('../controllers/alertController');
const commandController = require('../controllers/commandController');
const enrollController = require('../controllers/enrollController');
const { processResult } = require('../lib/resultConsumer');
const { agentAuth, dashboardAuth, requireAdmin } = require('../middleware/auth');

const prisma = new PrismaClient();

// ─── Enrollment — public endpoints (agent chưa có cert) ──────────────────────
// /api/enroll/status/:id dùng UUID (128-bit entropy) thay cho auth — đủ bảo mật
// ca-cert.pem được đóng gói sẵn trong agent installer — không cần endpoint /ca-cert

router.post('/enroll',                  enrollController.enroll);
router.get('/enroll/status/:requestId', enrollController.enrollStatus);

// ─── Enrollment — admin endpoints (cần JWT + OTP khi tạo code) ───────────────

router.post('/enroll/code',                          dashboardAuth, requireAdmin, enrollController.generateCode);
router.get('/enroll/codes',                          dashboardAuth, requireAdmin, enrollController.listCodes);
router.get('/enroll/requests',                       dashboardAuth, requireAdmin, enrollController.listRequests);
router.post('/enroll/requests/:id/approve',          dashboardAuth, requireAdmin, enrollController.approveRequest);
router.post('/enroll/requests/:id/reject',           dashboardAuth, requireAdmin, enrollController.rejectRequest);

// ─── Agent routes — xác thực bằng X-Agent-Key ────────────────────────────────

router.post('/heartbeat', agentAuth, agentController.heartbeat);

router.post('/events', agentAuth, async (req, res) => {
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

// Kết quả lệnh từ agent gửi thẳng về qua HTTP (primary path).
// Nếu agent không reach được backend, fallback RPUSH results:queue → BLPOP consumer xử lý.
router.post('/commands/result', agentAuth, async (req, res) => {
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

// ─── Dashboard routes — xác thực bằng JWT Bearer token ───────────────────────

router.get('/agents', dashboardAuth, agentController.listAgents);
router.get('/stats', dashboardAuth, agentController.getStats);

router.post('/agents/:agentId/commands', dashboardAuth, requireAdmin, commandController.sendCommand);
router.get('/agents/:agentId/commands/history', dashboardAuth, commandController.commandHistory);
router.post('/commands/batch', dashboardAuth, requireAdmin, commandController.sendBatchCommand);

router.get('/events', dashboardAuth, eventController.listEvents);

router.get('/alerts', dashboardAuth, alertController.listAlerts);
router.patch('/alerts/:id/resolve', dashboardAuth, alertController.resolveAlert);

// RULES CONFIG
const { RULES } = require('../services/ruleEngine');

router.get('/agents/:agentId/rules', dashboardAuth, async (req, res) => {
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

router.post('/agents/:agentId/rules', dashboardAuth, requireAdmin, async (req, res) => {
  const { config } = req.body;
  await prisma.agent.update({
    where: { id: req.params.agentId },
    data: { rulesConfig: JSON.stringify(config) }
  });
  res.json({ success: true });
});

module.exports = router;
