const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const apiRoutes = require('./src/routes/api');
const { registerSocketEvents } = require('./src/socket/events');

const app = express();
const server = http.createServer(app);

// Cho phép kết nối từ mọi origin (trong môi trường production nên giới hạn lại)
const io = new Server(server, { cors: { origin: '*' } });

// Bảng ánh xạ agentId → socketId, lưu trong RAM, chia sẻ qua app.set
const agentSockets = {};

// Đăng ký các sự kiện Socket.IO (chỉ dùng cho Commands, không dùng cho Metrics)
registerSocketEvents(io, agentSockets);

// Chia sẻ io và agentSockets cho các controller qua req.app.get(...)
app.set('io', io);
app.set('agentSockets', agentSockets);

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[EDR Backend] Server running on port ${PORT}`);
  console.log(`  - Socket.IO ready (Commands only)`);
  console.log(`  - Metrics via HTTP /api/heartbeat`);
});
