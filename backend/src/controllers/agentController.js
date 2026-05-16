const { PrismaClient } = require('@prisma/client');
const { dequeueCommands, markInProgress } = require('../lib/redis');
const { signCommand } = require('../lib/security');

const prisma = new PrismaClient();

// POST /api/heartbeat
// Agent gửi metrics + nhận về các lệnh pending trong cùng 1 request.
exports.heartbeat = async (req, res) => {
  try {
    const { agentId, hostname, ip, cpu_percent, memory_percent, iptables_rules, network_interfaces } = req.body;
    const id = agentId || require('crypto').randomUUID();

    const agent = await prisma.agent.upsert({
      where: { id },
      update: {
        lastHeartbeat: new Date(),
        status: 'online',
        cpuPercent: cpu_percent,
        memPercent: memory_percent,
        ...(iptables_rules !== undefined ? { iptablesRules: iptables_rules } : {}),
        ...(network_interfaces !== undefined ? { interfaces: JSON.stringify(network_interfaces) } : {}),
      },
      create: {
        id,
        hostname: hostname || 'Unknown-Host',
        ip: ip || req.ip || '127.0.0.1',
        cpuPercent: cpu_percent,
        memPercent: memory_percent,
        iptablesRules: iptables_rules || null,
        interfaces: network_interfaces ? JSON.stringify(network_interfaces) : null,
      },
    });

    // Dequeue lệnh pending từ Redis queue, fetch từ DB, ký và trả về trong response
    const commandIds = await dequeueCommands(id, 20);
    let commands = [];

    if (commandIds.length > 0) {
      const fetched = await prisma.$transaction(async (tx) => {
        const cmds = await tx.command.findMany({
          where: { id: { in: commandIds }, status: 'pending' },
          orderBy: { createdAt: 'asc' },
        });
        if (cmds.length > 0) {
          await tx.command.updateMany({
            where: { id: { in: cmds.map(c => c.id) } },
            data: { status: 'in_progress' },
          });
        }
        return cmds;
      });

      if (fetched.length > 0) {
        await markInProgress(id, fetched.map(c => c.id));
        commands = fetched.map(cmd => ({ ...cmd, signature: signCommand(cmd) }));
        console.log(`[HB] Agent "${agent.hostname}" → ${commands.length} lệnh pending [SIGNED]`);
      }
    }

    res.json({ status: 'ok', agentId: agent.id, commands });
  } catch (error) {
    console.error('[HB] Heartbeat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/agents
exports.listAgents = async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({ orderBy: { lastHeartbeat: 'desc' } });
    const now = new Date();
    const result = agents.map(a => ({
      ...a,
      status: (now - new Date(a.lastHeartbeat)) < 120_000 ? 'online' : 'offline',
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/stats
exports.getStats = async (req, res) => {
  try {
    const [totalAgents, activeAlerts, totalEvents] = await Promise.all([
      prisma.agent.count(),
      prisma.alert.count({ where: { resolved: false } }),
      prisma.event.count(),
    ]);
    res.json({ agents: totalAgents, alerts: activeAlerts, events: totalEvents });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
