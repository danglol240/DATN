/**
 * Socket.IO Events — chỉ dành cho Dashboard
 *
 * Agent không còn kết nối WebSocket. Dashboard vào room 'dashboards'
 * để nhận broadcast real-time: alert_notification, command_result, batch_progress.
 */

function registerSocketEvents(io) {
  io.on('connection', (socket) => {
    socket.on('join_dashboard', () => {
      socket.join('dashboards');
      console.log(`[WS] Dashboard → room "dashboards" (${socket.id})`);
    });
  });
}

module.exports = { registerSocketEvents };
