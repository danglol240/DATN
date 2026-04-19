const { PrismaClient } = require('@prisma/client');
const { detectRules } = require('../services/ruleEngine');

const prisma = new PrismaClient();

function registerSocketEvents(io, agentSockets) {
  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Dashboard clients join a shared room so backend can broadcast to all at once
    socket.on('join_dashboard', () => {
      socket.join('dashboards');
      console.log(`[WS] Dashboard joined room: ${socket.id}`);
    });

    // Agent registers its agentId so we can route commands to it
    socket.on('register_agent', async (agentId) => {
      agentSockets[agentId] = socket.id;
      socket.join(`agent:${agentId}`);
      console.log(`[WS] Agent '${agentId}' registered: ${socket.id}`);

      try {
        await prisma.agent.update({ where: { id: agentId }, data: { status: 'online' } });
      } catch (_) {}

      io.to('dashboards').emit('agent_connected', { agentId, timestamp: new Date() });
    });

    // Agent pushes metrics every 10 s — update DB and broadcast to all dashboards
    socket.on('metrics_update', async (data) => {
      const { agentId, cpu_percent, memory_percent, iptables_rules, network_interfaces, hostname } = data;
      try {
        await prisma.agent.update({
          where: { id: agentId },
          data: {
            cpuPercent: cpu_percent,
            memPercent: memory_percent,
            iptablesRules: iptables_rules ?? null,
            interfaces: network_interfaces ? JSON.stringify(network_interfaces) : null,
            lastHeartbeat: new Date(),
            status: 'online',
            ...(hostname ? { hostname } : {}),
          },
        });
      } catch (e) {
        console.error('[WS] metrics_update DB error:', e.message);
      }

      io.to('dashboards').emit('agent_metrics', data);
    });

    socket.on('disconnect', async () => {
      for (const [agentId, sId] of Object.entries(agentSockets)) {
        if (sId !== socket.id) continue;

        delete agentSockets[agentId];
        console.log(`[WS] Agent '${agentId}' disconnected`);
        io.to('dashboards').emit('agent_disconnected', { agentId, timestamp: new Date() });

        try {
          await prisma.agent.update({ where: { id: agentId }, data: { status: 'offline' } });
        } catch (_) {}
        break;
      }
    });
  });
}

module.exports = { registerSocketEvents };
