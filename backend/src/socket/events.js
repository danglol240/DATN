const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Socket.IO chỉ phục vụ 2 mục đích:
//   1. Dashboard join room 'dashboards' để nhận broadcast
//   2. Agent đăng ký để nhận lệnh điều khiển real-time
// Metrics KHÔNG đi qua socket — agent gửi qua HTTP /api/heartbeat mỗi 45s
function registerSocketEvents(io, agentSockets) {
  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Dashboard client gửi sự kiện này để vào room 'dashboards'
    // nhằm nhận các broadcast (alert_notification, batch_progress, command_result…)
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
