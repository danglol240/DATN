import { useEffect, useRef, useCallback, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';

// Singleton ở cấp module: mọi component dùng chung một kết nối socket duy nhất
// tránh tạo nhiều kết nối khi component re-render hoặc mount/unmount
let _socket = null;

function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,        // Không tự kết nối ngay, đợi useSocket gọi connect()
      reconnection: true,        // Tự động kết nối lại khi mất mạng
      reconnectionDelay: 1000,   // Chờ 1 giây trước khi thử lại
      reconnectionAttempts: Infinity, // Thử lại vô hạn lần
    });
  }
  return _socket;
}

export function useSocket() {
  const socketRef = useRef(getSocket());
  const [connected, setConnected] = useState(socketRef.current.connected);

  useEffect(() => {
    const s = socketRef.current;

    const onConnect = () => {
      setConnected(true);
      // Vào room 'dashboards' ngay khi kết nối để nhận broadcast từ backend
      s.emit('join_dashboard');
    };
    const onDisconnect = () => setConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    if (!s.connected) {
      s.connect();
    } else {
      // Đã kết nối sẵn (ví dụ component mount sau lần đầu) — join room luôn
      s.emit('join_dashboard');
    }

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, []);

  // Hàm đăng ký lắng nghe sự kiện, trả về hàm cleanup để dùng trong useEffect
  const on = useCallback((event, handler) => {
    const s = socketRef.current;
    s.on(event, handler);
    return () => s.off(event, handler);
  }, []);

  const emit = useCallback((event, data) => {
    socketRef.current.emit(event, data);
  }, []);

  return { socket: socketRef.current, connected, on, emit };
}
