const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const apiRoutes = require('./src/routes/api');
const { registerSocketEvents } = require('./src/socket/events');
const { startRetryWorker } = require('./workers/retryWorker');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// agentId → socketId mapping shared with controllers via app.set
const agentSockets = {};

registerSocketEvents(io, agentSockets);
startRetryWorker(io, agentSockets);

app.set('io', io);
app.set('agentSockets', agentSockets);

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[EDR Backend] Server running on port ${PORT}`);
  console.log(`  - Socket.IO real-time ready`);
  console.log(`  - Retry worker active (60 s interval)`);
});
