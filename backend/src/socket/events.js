const { PrismaClient } = require('@prisma/client');
const { detectRules } = require('../services/ruleEngine');

const prisma = new PrismaClient();

function registerSocketEvents(io, agentSockets) {
  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Dashboard client gửi sự kiện này để vào room 'dashboards'
    // nhằm nhận các broadcast (alert, batch_progress, agent_metrics…)
    socket.on('join_dashboard', () => {
      socket.join('dashboards');
      console.log(`[WS] Dashboard joined room: ${socket.id}`);
    });

    // Agent đăng ký agentId của mình để backend có thể route lệnh trực tiếp
    // Lưu socketId vào bảng agentSockets để dùng khi dispatch command
    socket.on('register_agent', async (agentId) => {
      agentSockets[agentId] = socket.id;
      socket.join(`agent:${agentId}`);
      console.log(`[WS] Agent '${agentId}' registered: ${socket.id}`);

      try {
        // Cập nhật trạng thái agent thành online trong DB
        await prisma.agent.update({ where: { id: agentId }, data: { status: 'online' } });
      } catch (_) {}

      // Thông báo cho tất cả dashboard biết có agent vừa kết nối
      io.to('dashboards').emit('agent_connected', { agentId, timestamp: new Date() });
    });

    // Agent đẩy metrics mỗi 10 giây qua socket thay vì HTTP heartbeat
    // để dashboard cập nhật real-time mà không cần polling
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

      // Phát lại metrics tới tất cả dashboard đang mở
      io.to('dashboards').emit('agent_metrics', data);
    });

    // Xử lý khi socket bị ngắt kết nối (agent tắt hoặc mất mạng)
    socket.on('disconnect', async () => {
      for (const [agentId, sId] of Object.entries(agentSockets)) {
        if (sId !== socket.id) continue;

        // Xóa khỏi bảng ánh xạ RAM và cập nhật trạng thái offline trong DB
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
