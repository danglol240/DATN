/**
 * Command Controller
 *
 * Luồng gửi lệnh:
 *   Dashboard → POST /commands → DB.create + Redis RPUSH
 *   Agent nhận lệnh qua heartbeat response (POST /api/heartbeat → { commands:[...] })
 *
 * Luồng phản hồi:
 *   Agent → PATCH /commands/:id/done { status, result }
 *         → DB.update + Redis SREM + Socket.IO emit tới dashboard
 */

const { PrismaClient } = require('@prisma/client');
const { enqueueCommand, removeFromInProgress } = require('../lib/redis');

const prisma = new PrismaClient();

// ─── Internal: Tạo lệnh trong DB và queue vào Redis ───────────────────────────

async function _createAndDispatch(agentId, action, params, batchJobId = null) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { ok: false, error: 'Agent không tồn tại', agentId };

  const command = await prisma.command.create({
    data: {
      agentId,
      action,
      params: JSON.stringify(params || {}),
      status: 'pending',
      ...(batchJobId ? { batchJobId } : {}),
    },
  });

  await enqueueCommand(agentId, command.id);
  console.log(`[CMD] Queued "${action}" → ${agent.hostname} — agent nhận tại heartbeat tiếp theo`);

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
        params: JSON.stringify(params || {}),
        totalAgents: agentIds.length,
        successfulAgents: [],
        failedAgents: [],
        status: 'dispatching',
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

// ─── PATCH /api/commands/:id/done ─────────────────────────────────────────────

exports.markDone = async (req, res) => {
  try {
    const { status = 'done', result = null } = req.body;

    const command = await prisma.command.update({
      where: { id: req.params.id },
      data:  { status, result, doneAt: new Date() },
    });

    await removeFromInProgress(command.agentId, command.id);

    const io = req.app.get('io');
    if (io) {
      io.to('dashboards').emit('command_result', {
        commandId:  command.id,
        agentId:    command.agentId,
        action:     command.action,
        status:     command.status,
        result:     command.result,
        doneAt:     command.doneAt,
        batchJobId: command.batchJobId ?? null,
      });

      if (command.batchJobId) {
        await _updateBatchProgress(io, command);
      }
    }

    console.log(`[CMD] ${command.action} → ${status.toUpperCase()} | ${result ?? '(no result)'}`);
    res.json(command);
  } catch (error) {
    console.error('[CMD] markDone error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── Internal: Cập nhật BatchJob progress ─────────────────────────────────────

async function _updateBatchProgress(io, command) {
  try {
    const isDone = command.status === 'done';
    const updatedJob = await prisma.batchJob.update({
      where: { id: command.batchJobId },
      data: isDone
        ? { successfulAgents: { push: command.agentId } }
        : { failedAgents:     { push: command.agentId } },
    });

    const totalDone = updatedJob.successfulAgents.length + updatedJob.failedAgents.length;
    let finalStatus = updatedJob.status;

    if (totalDone >= updatedJob.totalAgents) {
      finalStatus = updatedJob.failedAgents.length > 0 ? 'partial_failure' : 'success';
      await prisma.batchJob.update({
        where: { id: command.batchJobId },
        data:  { status: finalStatus },
      });
    }

    io.to('dashboards').emit('batch_progress', {
      batchJobId: command.batchJobId,
      success:    updatedJob.successfulAgents.length,
      failed:     updatedJob.failedAgents.length,
      total:      updatedJob.totalAgents,
      status:     finalStatus,
    });
  } catch (e) {
    console.error('[CMD] BatchJob progress update error:', e.message);
  }
}

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
