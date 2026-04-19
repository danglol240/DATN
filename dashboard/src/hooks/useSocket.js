import { useEffect, useRef, useCallback, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';

// Module-level singleton so every component shares one connection
let _socket = null;

function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
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
      s.emit('join_dashboard');
    };
    const onDisconnect = () => setConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    if (!s.connected) {
      s.connect();
    } else {
      s.emit('join_dashboard');
    }

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, []);

  // Returns a cleanup function so callers can do: useEffect(() => on('event', cb), [])
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
