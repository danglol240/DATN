/**
 * Redis Client
 *
 * Vai trò của Redis trong hệ thống:
 *   1. LIST  cmd:pending:{agentId}    → Fallback queue khi direct HTTPS push thất bại
 *   2. SET   cmd:inprogress:{agentId} → Track lệnh đang chạy
 *   3. LIST  results:queue            → Agent push kết quả; consumer BLPOP xử lý
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('connect',      () => console.log('[Redis] Connected →', REDIS_URL));
redis.on('error',        (err) => console.error('[Redis] Error:', err.message));
redis.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));

// ─── Key Helpers ──────────────────────────────────────────────────────────────

const KEYS = {
  cmdPending:    (agentId) => `cmd:pending:${agentId}`,
  cmdInProgress: (agentId) => `cmd:inprogress:${agentId}`,
};

const TTL = {
  CMD_PENDING:     86_400,  // 24h
  CMD_IN_PROGRESS:  7_200,  // 2h
};

// ─── Lua Script: Atomic Dequeue ───────────────────────────────────────────────
// LRANGE + LTRIM atomic → tránh race condition khi 2 heartbeat đồng thời.

const DEQUEUE_SCRIPT = `
local key   = KEYS[1]
local limit = tonumber(ARGV[1]) or 20
local ids   = redis.call('LRANGE', key, 0, limit - 1)
if #ids > 0 then
  redis.call('LTRIM', key, #ids, -1)
end
return ids
`;

async function dequeueCommands(agentId, limit = 20) {
  const ids = await redis.eval(DEQUEUE_SCRIPT, 1, KEYS.cmdPending(agentId), limit);
  return ids || [];
}

async function enqueueCommand(agentId, commandId) {
  const key = KEYS.cmdPending(agentId);
  await redis.pipeline()
    .rpush(key, commandId)
    .expire(key, TTL.CMD_PENDING)
    .exec();
}

async function markInProgress(agentId, commandIds) {
  if (!commandIds.length) return;
  const key = KEYS.cmdInProgress(agentId);
  await redis.pipeline()
    .sadd(key, ...commandIds)
    .expire(key, TTL.CMD_IN_PROGRESS)
    .exec();
}

async function removeFromInProgress(agentId, commandId) {
  await redis.srem(KEYS.cmdInProgress(agentId), commandId);
}

// ─── Results Queue ────────────────────────────────────────────────────────────

const RESULTS_KEY = 'results:queue';

module.exports = {
  redis,
  KEYS,
  TTL,
  RESULTS_KEY,
  enqueueCommand,
  dequeueCommands,
  markInProgress,
  removeFromInProgress,
};
