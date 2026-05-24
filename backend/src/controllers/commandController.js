/**
 * Command Controller
 *
 * Luồng gửi lệnh:
 *   Dashboard → POST /commands
 *     → DB.create
 *     → thử axios.post(agent.url/command)  [DIRECT HTTPS]
 *     → nếu thất bại: Redis RPUSH cmd:pending  [FALLBACK POLLING]
 *
 * Luồng phản hồi:
 *   Agent thực thi → Redis RPUSH results:queue
 *   Backend ResultConsumer BLPOP → DB.update + Socket.IO emit dashboard
 */

const https  = require('https');
const fs     = require('fs');
const axios  = require('axios');
const { PrismaClient } = require('@prisma/client');
const { signCommand }  = require('../lib/security');
const { enqueueCommand, markInProgress } = require('../lib/redis');

const prisma = new PrismaClient();

// Verify cert của agent qua CA chung — AGENT_CA_CERT trỏ đến ca-cert.pem
// Nếu chưa cấu hình thì cảnh báo và fallback không verify (dev only).
function _buildHttpsAgent() {
  const caPath = process.env.AGENT_CA_CERT;
  if (caPath && fs.existsSync(caPath)) {
    return new https.Agent({
      rejectUnauthorized: true,
      ca: fs.readFileSync(caPath),
    });
  }
  if (caPath) {
    console.warn(`[CMD] AGENT_CA_CERT="${caPath}" không tồn tại — fallback không verify (dev only)`);
  } else {
    console.warn('[CMD] AGENT_CA_CERT chưa cấu hình — fallback không verify (dev only)');
  }
  return new https.Agent({ rejectUnauthorized: false });
}

const httpsAgent = _buildHttpsAgent();

// ─── Internal: Tạo lệnh trong DB và dispatch ──────────────────────────────────

async function _createAndDispatch(agentId, action, params, batchJobId = null) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { ok: false, error: 'Agent không tồn tại', agentId };

  const command = await prisma.command.create({
    data: {
      agentId,
      action,
      params:    JSON.stringify(params || {}),
      status:    'pending',
      ...(batchJobId ? { batchJobId } : {}),
    },
  });

  const signed = { ...command, signature: signCommand(command) };

  // ── Thử push trực tiếp qua HTTPS ──────────────────────────────────────────
  if (agent.url) {
    try {
      await axios.post(`${agent.url}/command`, signed, {
        headers:    { 'X-Backend-Key': process.env.API_KEY },
        timeout:    5000,
        httpsAgent,
      });
      await prisma.command.update({
        where: { id: command.id },
        data:  { status: 'in_progress' },
      });
      await markInProgress(agentId, [command.id]);
      console.log(`[CMD] "${action}" → ${agent.hostname} [DIRECT HTTPS ✓]`);
      return { ok: true, command };
    } catch (err) {
      console.warn(`[CMD] Direct push thất bại (${agent.url}): ${err.message} — dùng fallback queue`);
    }
  }

  // ── Fallback: Redis queue — agent nhận tại heartbeat tiếp theo ─────────────
  await enqueueCommand(agentId, command.id);
  console.log(`[CMD] "${action}" → ${agent.hostname} [FALLBACK QUEUE]`);
  return { ok: true, command };
}

// ─── POST /api/agents/:agentId/commands ───────────────────────────────────────

exports.sendCommand = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { action, params } = req.body;

    if (!action) return res.status(400).json({ error: '"action" là bắt buộc' });

    const result = await _createAndDispatch(agentId, action, params);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.status(201).json(result.command);
  } catch (error) {
    console.error('[CMD] sendCommand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── POST /api/commands/batch ──────────────────────────────────────────────────

exports.sendBatchCommand = async (req, res) => {
  try {
    const { agentIds, action, params } = req.body;

    if (!Array.isArray(agentIds) || agentIds.length < 2)
      return res.status(400).json({ error: '"agentIds" phải là mảng ≥ 2 phần tử' });
    if (!action)
      return res.status(400).json({ error: '"action" là bắt buộc' });

    const io = req.app.get('io');

    const batchJob = await prisma.batchJob.create({
      data: {
        action,
        params:           JSON.stringify(params || {}),
        totalAgents:      agentIds.length,
        successfulAgents: [],
        failedAgents:     [],
        status:           'dispatching',
      },
    });

    const settled = await Promise.allSettled(
      agentIds.map(id => _createAndDispatch(id, action, params, batchJob.id))
    );

    const succeeded = settled
      .filter(r => r.status === 'fulfilled' && r.value.ok)
      .map(r => r.value.command);

    const failed = settled
      .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok))
      .map(r =>
        r.status === 'rejected'
          ? { agentId: 'unknown', error: r.reason?.message }
          : { agentId: r.value.agentId, error: r.value.error }
      );

    const jobStatus =
      failed.length === 0    ? 'dispatched'     :
      succeeded.length === 0 ? 'failure'         : 'partial_failure';

    await prisma.batchJob.update({
      where: { id: batchJob.id },
      data: {
        successfulAgents: succeeded.map(c => c.agentId),
        failedAgents:     failed.map(f => f.agentId),
        status:           jobStatus,
      },
    });

    io?.to('dashboards').emit('batch_progress', {
      batchJobId: batchJob.id,
      success:    succeeded.length,
      failed:     failed.length,
      total:      agentIds.length,
      status:     jobStatus,
    });

    res.status(failed.length > 0 ? 207 : 201).json({
      batchJobId: batchJob.id,
      dispatched: succeeded.length,
      commands:   succeeded,
      errors:     failed,
    });
  } catch (error) {
    console.error('[CMD] sendBatchCommand error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── GET /api/agents/:agentId/commands/history ────────────────────────────────

exports.commandHistory = async (req, res) => {
  try {
    const commands = await prisma.command.findMany({
      where:   { agentId: req.params.agentId },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    res.json(commands);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
