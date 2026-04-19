const express = require('express');
const cors = require('cors');
const http = require('http'); // Thêm http cho socket.io
const { Server } = require('socket.io'); // Thêm socket.io
const apiRoutes = require('./src/routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Lưu trữ mapping giữa agentId và socketId
const agentSockets = {};

io.on('connection', (socket) => {
  console.log(`[WS] Client đã kết nối: ${socket.id}`);

  // Agent đăng ký ID của nó
  socket.on('register_agent', (agentId) => {
    agentSockets[agentId] = socket.id;
    console.log(`[WS] Agent '${agentId}' đã đăng ký socket: ${socket.id}`);
  });

  socket.on('disconnect', () => {
    // Xóa khỏi mapping nếu ngắt kết nối
    for (const [agentId, sId] of Object.entries(agentSockets)) {
      if (sId === socket.id) {
        delete agentSockets[agentId];
        console.log(`[WS] Agent '${agentId}' đã ngắt kết nối websocket.`);
        break;
      }
    }
  });
});

// Truyền io và agentSockets vào app để controllers có thể sử dụng
app.set('io', io);
app.set('agentSockets', agentSockets);

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[EDR Backend] Server đang chạy trên cổng ${PORT}`);
  console.log(`  - Tích hợp WebSocket (Socket.IO) sẵn sàng`);
  console.log(`  - POST /api/heartbeat       (Agent gửi heartbeat)`);
  console.log(`  - POST /api/events          (Agent gửi event + Rule Engine tự động)`);
  console.log(`  - GET  /api/agents          (Dashboard xem danh sách agent)`);
  console.log(`  - GET  /api/events          (Dashboard xem events)`);
  console.log(`  - GET  /api/alerts          (Dashboard xem alerts)`);
  console.log(`  - PATCH /api/alerts/:id/resolve (SOC giải quyết alert)`);
  console.log(`  - GET  /api/stats           (Dashboard thống kê tổng quan)`);
});
