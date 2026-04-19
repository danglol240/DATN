const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function retryFailedBatchJobs(io, agentSockets) {
  try {
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
          // Retry commands are standalone — not linked to the original BatchJob
          // to keep BatchJob progress counts clean
          const command = await prisma.command.create({
            data: { agentId, action: job.action, params: job.params, status: 'pending' },
          });

          const socketId = agentSockets[agentId];
          if (io && socketId) {
            io.to(socketId).emit('new_command', command);
          }
        } catch (e) {
          console.error(`[RETRY] Dispatch to agent '${agentId}' failed:`, e.message);
        }
      }

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

function startRetryWorker(io, agentSockets) {
  console.log('[RETRY] Worker started — checking every 60 s');
  setInterval(() => retryFailedBatchJobs(io, agentSockets), 60_000);
}

module.exports = { startRetryWorker };
