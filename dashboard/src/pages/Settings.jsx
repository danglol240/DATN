import React, { useState } from 'react';
import { ShieldCheck, ShieldOff, QrCode, CheckCircle } from 'lucide-react';
import { getStoredToken } from '../hooks/useAuth';

const BASE = 'http://localhost:3000';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getStoredToken()}`,
  };
}

// ─── Panel bật 2FA ────────────────────────────────────────────────────────────
function Enable2FAPanel({ onDone }) {
  const [step, setStep]       = useState('idle'); // idle | qr | confirm
  const [qrData, setQrData]   = useState(null);
  const [code, setCode]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function fetchQR() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/auth/2fa/setup`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQrData(data);
      setStep('qr');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnable() {
    if (code.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/auth/2fa/enable`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStep('done');
      onDone(true);
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'idle') return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-400">
        Thêm lớp bảo mật thứ 2 bằng Google Authenticator. Mỗi lần đăng nhập bạn sẽ cần nhập mã 6 số từ app.
      </p>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        onClick={fetchQR}
        disabled={loading}
        className="self-start bg-[#FF2E63] hover:bg-[#e02558] disabled:opacity-50 text-white
                   font-semibold rounded-lg px-4 py-2 text-sm transition"
      >
        {loading ? 'Đang tạo QR…' : 'Bắt đầu thiết lập 2FA'}
      </button>
    </div>
  );

  if (step === 'qr') return (
    <div className="flex flex-col gap-5">
      <ol className="text-sm text-gray-400 list-decimal list-inside space-y-1">
        <li>Mở <span className="text-white font-medium">Google Authenticator</span> trên điện thoại</li>
        <li>Nhấn <span className="text-white font-medium">+</span> → Quét mã QR</li>
        <li>Quét mã bên dưới</li>
      </ol>

      <div className="flex justify-center">
        <img
          src={qrData.qrCodeDataUrl}
          alt="QR Code 2FA"
          className="rounded-xl border border-[#2E2F3A] w-48 h-48 bg-white p-2"
        />
      </div>

      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer hover:text-gray-400 transition">Không quét được? Nhập thủ công</summary>
        <code className="block mt-2 bg-[#111217] border border-[#2E2F3A] rounded px-3 py-2 text-gray-300 break-all select-all">
          {qrData.secret}
        </code>
      </details>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">
          Nhập mã 6 số để xác nhận
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="bg-[#111217] border border-[#2E2F3A] rounded-lg px-3 py-2 text-white text-sm
                     focus:outline-none focus:border-[#FF2E63] transition placeholder-gray-600 tracking-widest"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={confirmEnable}
        disabled={loading || code.length < 6}
        className="bg-[#FF2E63] hover:bg-[#e02558] disabled:opacity-50 text-white
                   font-semibold rounded-lg py-2 text-sm transition"
      >
        {loading ? 'Đang kích hoạt…' : 'Kích hoạt 2FA'}
      </button>
    </div>
  );

  if (step === 'done') return (
    <div className="flex items-center gap-3 text-green-400">
      <CheckCircle size={20} />
      <span className="text-sm font-medium">2FA đã được kích hoạt thành công!</span>
    </div>
  );
}

// ─── Panel tắt 2FA ─────────────────────────────────────────────────────────────
function Disable2FAPanel({ onDone }) {
  const [code, setCode]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleDisable() {
    if (code.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/auth/2fa/disable`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onDone(false);
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-400">
        Nhập mã từ Google Authenticator để tắt 2FA.
      </p>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Mã xác nhận</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="bg-[#111217] border border-[#2E2F3A] rounded-lg px-3 py-2 text-white text-sm
                     focus:outline-none focus:border-red-500 transition placeholder-gray-600 tracking-widest"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleDisable}
        disabled={loading || code.length < 6}
        className="self-start bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white
                   font-semibold rounded-lg px-4 py-2 text-sm transition"
      >
        {loading ? 'Đang tắt…' : 'Tắt 2FA'}
      </button>
    </div>
  );
}

// ─── Trang Settings chính ─────────────────────────────────────────────────────
export default function Settings({ user }) {
  const [is2FAEnabled, set2FAEnabled] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Lấy trạng thái 2FA hiện tại từ /auth/me
  React.useEffect(() => {
    fetch(`${BASE}/auth/me`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        // Backend /auth/me trả payload JWT, không có twoFactorEnabled
        // Nên ta dùng một endpoint riêng hoặc embed vào JWT.
        // Tạm thời fallback: không biết trạng thái → hiển thị cả 2 nút
        setInitialized(true);
      })
      .catch(() => setInitialized(true));
  }, []);

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-6">Cài đặt tài khoản</h1>

      {/* User info */}
      <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-xl p-4 mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[#FF2E63]/20 flex items-center justify-center">
          <span className="text-[#FF2E63] font-bold text-sm uppercase">
            {user?.username?.[0] ?? '?'}
          </span>
        </div>
        <div>
          <p className="text-white font-medium">{user?.username}</p>
          <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
        </div>
      </div>

      {/* 2FA Section */}
      <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          {is2FAEnabled
            ? <ShieldCheck size={20} className="text-green-400" />
            : <ShieldOff size={20} className="text-gray-500" />
          }
          <div>
            <h2 className="text-white font-semibold text-sm">Xác thực 2 lớp (2FA)</h2>
            <p className="text-xs text-gray-500">
              {is2FAEnabled ? 'Đang bật — Tài khoản được bảo vệ' : 'Đang tắt — Nên bật để tăng bảo mật'}
            </p>
          </div>
          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full
            ${is2FAEnabled ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'}`}>
            {is2FAEnabled ? 'Bật' : 'Tắt'}
          </span>
        </div>

        <div className="border-t border-[#2E2F3A] pt-4">
          {!is2FAEnabled ? (
            <Enable2FAPanel onDone={set2FAEnabled} />
          ) : (
            <Disable2FAPanel onDone={set2FAEnabled} />
          )}
        </div>
      </div>
    </div>
  );
}
