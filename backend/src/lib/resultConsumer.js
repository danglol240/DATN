/**
 * Result Consumer
 *
 * BLPOP results:queue — xử lý kết quả lệnh từ agent:
 *   1. Cập nhật Command trong PostgreSQL (status, result, doneAt)
 *   2. Xoá khỏi Redis in-progress set
 *   3. Socket.IO broadcast 'command_result' tới dashboard
 *   4. Cập nhật BatchJob progress nếu có
 *
 * Dùng một Redis connection riêng (blocking) để không ảnh hưởng connection chính.
 */

const Redis  = require('ioredis');
const { removeFromInProgress, RESULTS_KEY } = require('./redis');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function _updateBatchProgress(io, command) {
  try {
    const isDone     = command.status === 'done';
    const updatedJob = await prisma.batchJob.update({
      where: { id: command.batchJobId },
      data:  isDone
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
    console.error('[ResultConsumer] BatchJob update error:', e.message);
  }
}

async function startResultConsumer(io) {
  // Connection riêng cho BLPOP — maxRetriesPerRequest: null bắt buộc cho blocking commands
  const consumer = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck:     true,
  });

  consumer.on('connect',      () => console.log('[ResultConsumer] Redis connected'));
  consumer.on('error',        (err) => console.error('[ResultConsumer] Redis error:', err.message));
  consumer.on('reconnecting', () => console.warn('[ResultConsumer] Reconnecting...'));

  console.log(`[ResultConsumer] Started — BLPOP ${RESULTS_KEY}`);

  while (true) {
    try {
      // Chờ tối đa 5 giây, trả null nếu không có item
      const item = await consumer.blpop(RESULTS_KEY, 5);
      if (!item) continue;

      const [, raw] = item;
      const { commandId, agentId, status, result } = JSON.parse(raw);

      const command = await prisma.command.update({
        where: { id: commandId },
        data:  { status, result: result ?? null, doneAt: new Date() },
      });

      await removeFromInProgress(agentId, commandId);

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

      console.log(`[Result] ${command.action} → ${status.toUpperCase()} | ${result ?? ''}`);
    } catch (err) {
      console.error('[ResultConsumer] Error:', err.message);
      // Back off 1s trước khi thử lại để tránh tight loop khi DB/Redis lỗi
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

module.exports = { startResultConsumer };
