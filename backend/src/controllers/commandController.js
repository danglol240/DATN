const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function _createAndDispatch(agentId, action, params, io, agentSockets, batchJobId = null) {
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

  console.log(`[CMD] Lưu lệnh "${action}" tới DB cho agent ${agent.hostname} (${agentId})`);

  const socketId = agentSockets && agentSockets[agentId];
  if (io && socketId) {
    io.to(socketId).emit('new_command', command);
    console.log(`[WS] Đã gửi lệnh "${action}" (ID: ${command.id}) real-time xuống Agent.`);
  } else {
    console.log(`[WS] Agent '${agentId}' không kết nối socket. Chờ agent tự poll.`);
  }

  return { ok: true, command };
}

/**
 * POST /api/agents/:agentId/commands
 */
exports.sendCommand = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { action, params } = req.body;

    if (!action) return res.status(400).json({ error: '"action" là bắt buộc' });

    const io = req.app.get('io');
    const agentSockets = req.app.get('agentSockets');
    const result = await _createAndDispatch(agentId, action, params, io, agentSockets);

    if (!result.ok) return res.status(404).json({ error: result.error });
    res.status(201).json(result.command);
  } catch (error) {
    console.error('Send command error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/commands/batch
 * Promise.allSettled so one failing agent never aborts the whole batch.
 * Creates a BatchJob record so the retry worker and dashboard can track progress.
 */
exports.sendBatchCommand = async (req, res) => {
  try {
    const { agentIds, action, params } = req.body;

    if (!Array.isArray(agentIds) || agentIds.length < 2)
      return res.status(400).json({ error: '"agentIds" phải là mảng có ít nhất 2 phần tử' });
    if (!action)
      return res.status(400).json({ error: '"action" là bắt buộc' });

    const io = req.app.get('io');
    const agentSockets = req.app.get('agentSockets');

    // Create the BatchJob first so we can link commands to it
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
      agentIds.map(id => _createAndDispatch(id, action, params, io, agentSockets, batchJob.id))
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
      failed.length === 0 ? 'dispatched' :
      succeeded.length === 0 ? 'failure' : 'partial_failure';

    await prisma.batchJob.update({
      where: { id: batchJob.id },
      data: {
        successfulAgents: succeeded.map(c => c.agentId),
        failedAgents: failed.map(f => f.agentId),
        status: jobStatus,
      },
    });

    // Broadcast initial dispatch result to all dashboard clients
    io?.to('dashboards').emit('batch_progress', {
      batchJobId: batchJob.id,
      success: succeeded.length,
      failed: failed.length,
      total: agentIds.length,
      status: jobStatus,
    });

    const httpStatus = failed.length > 0 ? 207 : 201;
    res.status(httpStatus).json({
      batchJobId: batchJob.id,
      dispatched: succeeded.length,
      commands: succeeded,
      errors: failed,
    });
  } catch (error) {
    console.error('Batch command error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/agents/:agentId/commands
 * Transaction atomically fetches pending commands and marks them in_progress,
 * preventing two concurrent polls from claiming the same work.
 */
exports.pollCommands = async (req, res) => {
  try {
    const { agentId } = req.params;

    const commands = await prisma.$transaction(async (tx) => {
      const pending = await tx.command.findMany({
        where: { agentId, status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });

      if (pending.length > 0) {
        await tx.command.updateMany({
          where: { id: { in: pending.map(c => c.id) } },
          data: { status: 'in_progress' },
        });
      }

      return pending;
    });

    res.json(commands);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /api/commands/:id/done
 * Marks a command done/failed, emits command_result to dashboards,
 * and updates the parent BatchJob progress counter if applicable.
 */
exports.markDone = async (req, res) => {
  try {
    const command = await prisma.command.update({
      where: { id: req.params.id },
      data: { status: req.body.status || 'done', doneAt: new Date() },
    });

    const io = req.app.get('io');
    if (io) {
      io.to('dashboards').emit('command_result', {
        commandId: command.id,
        agentId: command.agentId,
        action: command.action,
        status: command.status,
        doneAt: command.doneAt,
        batchJobId: command.batchJobId ?? null,
      });

      // Keep BatchJob progress counters in sync
      if (command.batchJobId) {
        try {
          const isDone = command.status === 'done';
          const updatedJob = await prisma.batchJob.update({
            where: { id: command.batchJobId },
            data: isDone
              ? { successfulAgents: { push: command.agentId } }
              : { failedAgents: { push: command.agentId } },
          });

          const totalDone = updatedJob.successfulAgents.length + updatedJob.failedAgents.length;
          let finalStatus = updatedJob.status;
          if (totalDone >= updatedJob.totalAgents) {
            finalStatus = updatedJob.failedAgents.length > 0 ? 'partial_failure' : 'success';
            await prisma.batchJob.update({
              where: { id: command.batchJobId },
              data: { status: finalStatus },
            });
          }

          io.to('dashboards').emit('batch_progress', {
            batchJobId: command.batchJobId,
            success: updatedJob.successfulAgents.length,
            failed: updatedJob.failedAgents.length,
            total: updatedJob.totalAgents,
            status: finalStatus,
          });
        } catch (e) {
          console.error('[CMD] BatchJob progress update error:', e.message);
        }
      }
    }

    res.json(command);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/agents/:agentId/commands/history
 */
exports.commandHistory = async (req, res) => {
  try {
    const { agentId } = req.params;
    const commands = await prisma.command.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(commands);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
