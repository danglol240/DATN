const { PrismaClient } = require('@prisma/client');
const { dequeueCommands, markInProgress } = require('../lib/redis');
const { signCommand } = require('../lib/security');

const prisma = new PrismaClient();

// POST /api/heartbeat
// Agent gửi metrics + port → backend lưu agent.url để push lệnh trực tiếp.
// Response trả về lệnh fallback (nếu direct push trước đó thất bại).
exports.heartbeat = async (req, res) => {
  try {
    const {
      agentId, hostname, ip, port,
      cpu_percent, memory_percent,
      iptables_rules, network_interfaces,
    } = req.body;

    const id = agentId || require('crypto').randomUUID();

    // Xây dựng URL của agent server từ IP + port
    const rawIp  = (ip || req.ip || '127.0.0.1').replace('::ffff:', '');
    const agentUrl = port ? `https://${rawIp}:${port}` : null;

    const agent = await prisma.agent.upsert({
      where: { id },
      update: {
        lastHeartbeat: new Date(),
        status:        'online',
        cpuPercent:    cpu_percent,
        memPercent:    memory_percent,
        ...(agentUrl                  ? { url: agentUrl }                               : {}),
        ...(iptables_rules  !== undefined ? { iptablesRules: iptables_rules }           : {}),
        ...(network_interfaces !== undefined ? { interfaces: JSON.stringify(network_interfaces) } : {}),
      },
      create: {
        id,
        hostname:      hostname || 'Unknown-Host',
        ip:            rawIp,
        url:           agentUrl,
        cpuPercent:    cpu_percent,
        memPercent:    memory_percent,
        iptablesRules: iptables_rules    || null,
        interfaces:    network_interfaces ? JSON.stringify(network_interfaces) : null,
      },
    });

    // Dequeue lệnh fallback từ Redis (chỉ có khi direct push thất bại trước đó)
    const commandIds = await dequeueCommands(id, 20);
    let commands = [];

    if (commandIds.length > 0) {
      const fetched = await prisma.$transaction(async (tx) => {
        const cmds = await tx.command.findMany({
          where:   { id: { in: commandIds }, status: 'pending' },
          orderBy: { createdAt: 'asc' },
        });
        if (cmds.length > 0) {
          await tx.command.updateMany({
            where: { id: { in: cmds.map(c => c.id) } },
            data:  { status: 'in_progress' },
          });
        }
        return cmds;
      });

      if (fetched.length > 0) {
        await markInProgress(id, fetched.map(c => c.id));
        commands = fetched.map(cmd => ({ ...cmd, signature: signCommand(cmd) }));
        console.log(`[HB] Agent "${agent.hostname}" → ${commands.length} lệnh fallback [SIGNED]`);
      }
    }

    res.json({ status: 'ok', agentId: agent.id, commands });
  } catch (error) {
    console.error('[HB] Heartbeat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/agents
exports.listAgents = async (_req, res) => {
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
exports.getStats = async (_req, res) => {
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
