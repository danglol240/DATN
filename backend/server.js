const express = require('express');
const cors    = require('cors');
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const { Server } = require('socket.io');
const client  = require('prom-client');

const apiRoutes  = require('./src/routes/api');
const authRoutes = require('./src/routes/auth');
const { registerSocketEvents } = require('./src/socket/events');

const app = express();

// ─── HTTPS hoặc HTTP tuỳ theo SSL_CERT / SSL_KEY trong .env ──────────────────
const SSL_CERT = process.env.SSL_CERT;
const SSL_KEY  = process.env.SSL_KEY;

let server;
let protocol = 'http';

if (SSL_CERT && SSL_KEY && fs.existsSync(SSL_CERT) && fs.existsSync(SSL_KEY)) {
  server = https.createServer({
    cert: fs.readFileSync(SSL_CERT),
    key:  fs.readFileSync(SSL_KEY),
    // requestCert: yêu cầu agent gửi client cert (mTLS)
    // rejectUnauthorized: false → không reject ngay, để agentCertAuth middleware tự verify bằng DB
    requestCert:        true,
    rejectUnauthorized: false,
  }, app);
  protocol = 'https';
  console.log('TLS mode  → cert:', SSL_CERT, ' | mTLS requestCert: true');
} else {
  server = http.createServer(app);
  if (SSL_CERT || SSL_KEY) {
    console.warn('WARNING: SSL_CERT/SSL_KEY khai báo nhưng file không tồn tại — fallback HTTP');
  }
}

// Socket.IO chỉ dùng để dashboard nhận broadcast real-time.
// Agent không kết nối WebSocket — giao tiếp qua HTTPS + Redis.
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
});

registerSocketEvents(io);
app.set('io', io);

app.use(cors());
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

client.collectDefaultMetrics();
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[EDR Backend] Listening on ${protocol}://0.0.0.0:${PORT}`);
  console.log('  Auth          → X-Agent-Key (API_KEY)');
  console.log('  Agent push    → HTTPS direct mTLS → agent:8443/command');
  console.log('  Results       → POST /api/commands/result (HTTP direct)');
  console.log('  Socket.IO     → Dashboard real-time broadcast');
});
