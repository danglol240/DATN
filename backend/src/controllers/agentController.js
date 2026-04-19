const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { detectRules } = require('../services/ruleEngine');

// POST /api/heartbeat - Agent gửi heartbeat kèm thông tin hệ thống
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
        ...(network_interfaces !== undefined ? { interfaces: JSON.stringify(network_interfaces) } : {})
      },
      create: { 
        id, 
        hostname: hostname || 'Unknown-Host', 
        ip: ip || req.ip || '127.0.0.1', 
        cpuPercent: cpu_percent, 
        memPercent: memory_percent,
        iptablesRules: iptables_rules || null,
        interfaces: network_interfaces ? JSON.stringify(network_interfaces) : null
      }
    });

    res.json({ status: 'ok', agentId: agent.id });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/agents - Dashboard đọc danh sách agent
exports.listAgents = async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({ orderBy: { lastHeartbeat: 'desc' } });
    const now = new Date();
    // Agent được coi là offline nếu không có heartbeat trong 2 phút gần nhất
    const updatedAgents = agents.map(a => {
      const isOnline = (now - new Date(a.lastHeartbeat)) < 120000;
      return { ...a, status: isOnline ? 'online' : 'offline' };
    });
    res.json(updatedAgents);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/stats - Dashboard đọc số liệu tổng quan (Số agent, số alert đang active, số event trong 24h)
exports.getStats = async (req, res) => {
  try {
    const [totalAgents, activeAlerts, totalEvents] = await Promise.all([
      prisma.agent.count(),
      prisma.alert.count({ where: { resolved: false } }),
      prisma.event.count()
    ]);
    res.json({ agents: totalAgents, alerts: activeAlerts, events: totalEvents });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
