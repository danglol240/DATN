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
const { logAudit } = require('../lib/audit');
const prisma = new PrismaClient();

// Xây dựng httpsAgent per-agent dựa trên cert lưu trong DB (cert pinning).
async function _getHttpsAgentForAgent(agentId) {
  const certPath = process.env.BACKEND_CERT;
  const keyPath  = process.env.BACKEND_KEY;

  const opts = { rejectUnauthorized: false };

  const agentKey = await prisma.agentKey.findUnique({ where: { agentId } });
  if (agentKey) {
    opts.rejectUnauthorized = true;
    opts.ca = agentKey.certPem;
  } else {
    console.warn(`[CMD] Agent ${agentId} chưa có cert trong DB — bỏ qua TLS verify`);
  }

  // Backend client cert để agent server verify (mTLS)
  if (certPath && fs.existsSync(certPath) && keyPath && fs.existsSync(keyPath)) {
    opts.cert = fs.readFileSync(certPath);
    opts.key  = fs.readFileSync(keyPath);
  }

  return new https.Agent(opts);
}

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

  if (!agent.url)
    return { ok: false, error: `Agent ${agent.hostname} chưa có URL — chưa heartbeat lần nào`, agentId };

  const httpsAgent = await _getHttpsAgentForAgent(agentId);
  await axios.post(`${agent.url}/command`, command, { timeout: 5000, httpsAgent });

  await prisma.command.update({
    where: { id: command.id },
    data:  { status: 'in_progress' },
  });

  console.log(`[CMD] "${action}" → ${agent.hostname} [DIRECT HTTPS ✓]`);
  return { ok: true, command };
}

// ─── POST /api/agents/:agentId/commands ───────────────────────────────────────

exports.sendCommand = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { action, params } = req.body;

    if (!action) return res.status(400).json({ error: '"action" là bắt buộc' });

    const result = await _createAndDispatch(agentId, action, params);
    if (!result.ok) {
      await logAudit(req, 'COMMAND_SEND', `agent:${agentId}`, `action=${action} — ${result.error}`, 'failure');
      return res.status(404).json({ error: result.error });
    }
    await logAudit(req, 'COMMAND_SEND', `agent:${agentId}`, `action=${action}`, 'success');
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

    await logAudit(
      req, 'COMMAND_BATCH_SEND', `batchJob:${batchJob.id}`,
      `action=${action} total=${agentIds.length} ok=${succeeded.length} fail=${failed.length}`,
      failed.length === agentIds.length ? 'failure' : 'success'
    );

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
