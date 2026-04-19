const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function _createAndDispatch(agentId, action, params, io, agentSockets) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { ok: false, error: 'Agent không tồn tại', agentId };

  const command = await prisma.command.create({
    data: { agentId, action, params: JSON.stringify(params || {}), status: 'pending' },
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
 * Dashboard / SOC gửi lệnh xuống Agent (vd: block_ip, unblock_ip)
 * Body: { action: "block_ip", params: { ip: "1.2.3.4" } }
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
 * Gửi cùng 1 lệnh tới nhiều agent cùng lúc
 * Body: { agentIds: string[], action: string, params: object }
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

    const results = await Promise.all(
      agentIds.map(id => _createAndDispatch(id, action, params, io, agentSockets))
    );

    const succeeded = results.filter(r => r.ok).map(r => r.command);
    const failed    = results.filter(r => !r.ok).map(r => ({ agentId: r.agentId, error: r.error }));

    const status = failed.length > 0 ? 207 : 201;
    res.status(status).json({ dispatched: succeeded.length, commands: succeeded, errors: failed });
  } catch (error) {
    console.error('Batch command error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/agents/:agentId/commands
 * Agent poll lệnh pending -> thực thi iptables
 */
exports.pollCommands = async (req, res) => {
  try {
    const { agentId } = req.params;

    const commands = await prisma.command.findMany({
      where: { agentId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    res.json(commands);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /api/commands/:id/done
 * Agent báo hoàn thành lệnh
 */
exports.markDone = async (req, res) => {
  try {
    const command = await prisma.command.update({
      where: { id: req.params.id },
      data: { status: req.body.status || 'done', doneAt: new Date() },
    });
    res.json(command);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/agents/:agentId/commands/history
 * Dashboard xem lịch sử lệnh đã gửi tới agent
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
