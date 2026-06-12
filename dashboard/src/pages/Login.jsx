import React, { useState, useRef, useEffect } from 'react';
import { ShieldCheck, Eye, EyeOff, Smartphone } from 'lucide-react';

// ─── Bước 1: nhập username + password ────────────────────────────────────────
function StepPassword({ onNext }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onNext(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Username</label>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          className="bg-[#111217] border border-[#2E2F3A] rounded-lg px-3 py-2 text-white text-sm
                     focus:outline-none focus:border-[#FF2E63] transition placeholder-gray-600"
          placeholder="admin"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Password</label>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full bg-[#111217] border border-[#2E2F3A] rounded-lg px-3 py-2 pr-10
                       text-white text-sm focus:outline-none focus:border-[#FF2E63] transition
                       placeholder-gray-600"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 bg-[#FF2E63] hover:bg-[#e02558] disabled:opacity-50 disabled:cursor-not-allowed
                   text-white font-semibold rounded-lg py-2.5 text-sm transition"
      >
        {loading ? 'Đang kiểm tra…' : 'Tiếp tục'}
      </button>
    </form>
  );
}

// ─── Bước 2: nhập mã 6 số từ Google Authenticator ────────────────────────────
function Step2FA({ onVerify, onBack }) {
  const [value, setValue]     = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  // Focus input ẩn ngay khi bước 2 xuất hiện
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Auto-submit khi đủ 6 số
  useEffect(() => {
    if (value.length === 6 && !loading) submit(value);
  }, [value]);

  async function submit(code) {
    setError('');
    setLoading(true);
    try {
      await onVerify(code);
    } catch (err) {
      setError(err.message);
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e) {
    const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6);
    setValue(cleaned);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 bg-[#111217] border border-[#2E2F3A] rounded-lg px-4 py-3">
        <Smartphone size={18} className="text-[#FF2E63] shrink-0" />
        <p className="text-sm text-gray-400">
          Mở <span className="text-white font-medium">Google Authenticator</span> và nhập mã 6 số
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Input ẩn — bắt toàn bộ phím gõ */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        disabled={loading}
        className="sr-only"
        autoComplete="one-time-code"
      />

      {/* 6 ô hiển thị — click vào bất kỳ ô nào để focus input ẩn */}
      <div
        className="flex gap-2 justify-center cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-11 h-12 flex items-center justify-center text-xl font-bold
                        border rounded-lg text-white transition select-none
                        ${loading ? 'opacity-50' : ''}
                        ${i === value.length && !loading
                          ? 'border-[#FF2E63] border-2 bg-[#FF2E63]/5'
                          : value[i]
                            ? 'border-[#FF2E63] bg-[#111217]'
                            : 'border-[#2E2F3A] bg-[#111217]'
                        }`}
          >
            {value[i] ?? ''}
          </div>
        ))}
      </div>

      {loading && (
        <p className="text-center text-sm text-gray-400 animate-pulse">Đang xác thực…</p>
      )}

      <button
        type="button"
        onClick={onBack}
        className="text-gray-500 hover:text-gray-300 text-sm text-center transition"
      >
        ← Quay lại đăng nhập
      </button>
    </div>
  );
}

// ─── Container chính ──────────────────────────────────────────────────────────
export default function Login({ onLogin, onVerify2FA, awaiting2FA }) {
  return (
    <div className="min-h-screen bg-[#111217] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-2xl p-4">
            <ShieldCheck size={36} className="text-[#FF2E63]" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide">
            <span className="text-[#FF2E63]">Final</span>PROJECT
          </h1>
          <p className="text-gray-500 text-sm">
            {awaiting2FA ? 'Xác thực 2 lớp' : 'Đăng nhập để tiếp tục'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          <div className={`flex-1 h-1 rounded-full ${!awaiting2FA ? 'bg-[#FF2E63]' : 'bg-[#FF2E63]'}`} />
          <div className={`flex-1 h-1 rounded-full ${awaiting2FA ? 'bg-[#FF2E63]' : 'bg-[#2E2F3A]'}`} />
        </div>

        <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-2xl p-6">
            {!awaiting2FA ? (
            <StepPassword onNext={onLogin} />
          ) : (
            <Step2FA
              onVerify={onVerify2FA}
              onBack={() => window.location.reload()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
