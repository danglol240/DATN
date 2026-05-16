const crypto = require('crypto');

/**
 * Ký command bằng HMAC-SHA256 dùng API_KEY từ env.
 * Payload: id:agentId:action:params (params là chuỗi JSON từ DB).
 *
 * Agent sẽ verify chữ ký này trước khi thực thi lệnh.
 *
 * @param {object} command  - Prisma Command object
 * @returns {string}        - HMAC hex string
 */
function signCommand(command) {
  const secret = process.env.API_KEY;
  if (!secret) throw new Error('API_KEY chưa được cấu hình trong .env');

  const payload = `${command.id}:${command.agentId}:${command.action}:${command.params}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

module.exports = { signCommand };
