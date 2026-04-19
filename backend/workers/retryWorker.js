const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Tìm và tái gửi lệnh cho các agent thất bại trong batch
async function retryFailedBatchJobs(io, agentSockets) {
  try {
    // Chỉ retry các job bị partial_failure và chưa vượt quá số lần thử tối đa
    const failedJobs = await prisma.batchJob.findMany({
      where: { status: 'partial_failure', retryCount: { lt: 3 } },
    });

    for (const job of failedJobs) {
      if (job.failedAgents.length === 0) continue;

      console.log(
        `[RETRY] BatchJob ${job.id} — attempt ${job.retryCount + 1}/${job.maxRetries} ` +
        `for ${job.failedAgents.length} agent(s)`
      );

      for (const agentId of job.failedAgents) {
        try {
          // Tạo lệnh độc lập (không gắn batchJobId) để tránh làm lệch
          // bộ đếm tiến trình của BatchJob gốc
          const command = await prisma.command.create({
            data: { agentId, action: job.action, params: job.params, status: 'pending' },
          });

          // Nếu agent đang kết nối socket thì gửi ngay, không thì agent sẽ tự poll
          const socketId = agentSockets[agentId];
          if (io && socketId) {
            io.to(socketId).emit('new_command', command);
          }
        } catch (e) {
          console.error(`[RETRY] Dispatch to agent '${agentId}' failed:`, e.message);
        }
      }

      // Cập nhật số lần đã retry và trạng thái tương ứng
      const nextCount = job.retryCount + 1;
      await prisma.batchJob.update({
        where: { id: job.id },
        data: {
          retryCount: nextCount,
          status: nextCount >= job.maxRetries ? 'max_retries_reached' : 'retrying',
        },
      });
    }
  } catch (e) {
    console.error('[RETRY] Worker error:', e.message);
  }
}

// Khởi động worker chạy định kỳ mỗi 60 giây
function startRetryWorker(io, agentSockets) {
  console.log('[RETRY] Worker started — checking every 60 s');
  setInterval(() => retryFailedBatchJobs(io, agentSockets), 60_000);
}

module.exports = { startRetryWorker };
