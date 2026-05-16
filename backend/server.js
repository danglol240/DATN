const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');
const client  = require('prom-client');

const apiRoutes = require('./src/routes/api');
const { registerSocketEvents } = require('./src/socket/events');

const app    = express();
const server = http.createServer(app);

// Socket.IO chỉ dùng để dashboard nhận broadcast real-time.
// Agent không kết nối WebSocket — dùng HTTP heartbeat polling.
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
});

registerSocketEvents(io);
app.set('io', io);

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

client.collectDefaultMetrics();
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[EDR Backend] Listening on :${PORT}`);
  console.log('  HTTP       → Agent heartbeat + polling');
  console.log('  Socket.IO  → Dashboard real-time broadcast');
  console.log('  Redis      → Command queue');
});
