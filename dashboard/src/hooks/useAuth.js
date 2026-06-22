import { useState, useCallback } from 'react';

const TOKEN_KEY = 'edr_token';
const USER_KEY  = 'edr_user';
const BASE = '';

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function useAuth() {
  const [token, setToken]       = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser]         = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  });
  // Trạng thái chờ bước 2FA: lưu tempToken trả về từ login
  const [tempToken, setTempToken] = useState(null);

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Đăng nhập thất bại');

    // Nếu user đã bật 2FA → chưa lưu JWT, chờ bước xác thực OTP
    if (data.requires2FA) {
      setTempToken(data.tempToken);
      return { requires2FA: true };
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return { requires2FA: false };
  }, []);

  const verify2FA = useCallback(async (code) => {
    if (!tempToken) throw new Error('Không có phiên 2FA đang chờ');

    const res = await fetch(`${BASE}/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Xác thực 2FA thất bại');

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setTempToken(null);
  }, [tempToken]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setTempToken(null);
  }, []);

  return {
    token,
    user,
    login,
    verify2FA,
    logout,
    isAuthenticated: !!token,
    // true khi đã xác thực password nhưng chưa nhập mã OTP
    awaiting2FA: !!tempToken,
  };
}
