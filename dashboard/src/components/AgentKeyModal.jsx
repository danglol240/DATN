import React, { useState, useEffect, useRef } from 'react';
import { Key, X, Trash2, Download, Plus, Copy, Check, AlertTriangle, Shield, Upload, FileText, CheckCircle2 } from 'lucide-react';
import { getAgentKey, addAgentKey, deleteAgentKey, exportAgentKey } from '../hooks/useApi';

function PemFileInput({ label, required, accept, value, onChange }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');

  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      onChange(e.target.result);
      setFileName(file.name);
    };
    reader.readAsText(file);
  };

  const onFileChange = (e) => readFile(e.target.files[0]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer.files[0]);
  };

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const hasContent = value && value.trim().length > 0;

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer transition-colors py-5
          ${dragging
            ? 'border-[#FF2E63] bg-[#FF2E63]/5'
            : hasContent
            ? 'border-green-500/40 bg-green-500/5 hover:bg-green-500/10'
            : 'border-[#3A3B45] bg-[#111217] hover:border-[#FF2E63]/50 hover:bg-[#FF2E63]/5'
          }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onFileChange}
          className="hidden"
        />

        {hasContent ? (
          <>
            <CheckCircle2 size={22} className="text-green-400" />
            <div className="text-center">
              <p className="text-sm text-green-400 font-medium">{fileName || 'File đã tải'}</p>
              <p className="text-xs text-gray-500 mt-0.5">Click để chọn file khác</p>
            </div>
          </>
        ) : (
          <>
            <Upload size={22} className={dragging ? 'text-[#FF2E63]' : 'text-gray-500'} />
            <div className="text-center">
              <p className="text-sm text-gray-300">Kéo thả hoặc <span className="text-[#FF2E63]">chọn file</span></p>
              <p className="text-xs text-gray-600 mt-0.5">.pem · .crt · .key</p>
            </div>
          </>
        )}
      </div>

      {/* Preview */}
      {hasContent && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-400 select-none flex items-center gap-1">
            <FileText size={11} /> Xem nội dung
          </summary>
          <pre className="mt-1.5 bg-[#111217] border border-[#2E2F3A] rounded-lg p-3 text-[11px] text-gray-400 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
            {value}
          </pre>
        </details>
      )}
    </div>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handle} className="text-gray-500 hover:text-gray-300 transition" title="Copy">
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  );
}

export default function AgentKeyModal({ agent, onClose }) {
  const [keyInfo, setKeyInfo]       = useState(undefined); // undefined=loading, null=none
  const [tab, setTab]               = useState('info');     // 'info' | 'add'
  const [certPem, setCertPem]       = useState('');
  const [keyPem, setKeyPem]         = useState('');
  const [label, setLabel]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [exporting, setExporting]   = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    if (!agent) return;
    getAgentKey(agent.id)
      .then(k => setKeyInfo(k))
      .catch(() => setKeyInfo(null));
  }, [agent?.id]);

  const handleSave = async () => {
    setError('');
    if (!certPem.trim() || !keyPem.trim()) {
      setError('Cần nhập đủ cert PEM và key PEM');
      return;
    }
    setSaving(true);
    try {
      const result = await addAgentKey(agent.id, certPem.trim(), keyPem.trim(), label.trim());
      setKeyInfo(result);
      setTab('info');
      setCertPem(''); setKeyPem(''); setLabel('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Xóa key của agent này? Backend sẽ không verify được cert khi gửi lệnh.')) return;
    try {
      await deleteAgentKey(agent.id);
      setKeyInfo(null);
      setTab('add');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportAgentKey(agent.id);
      const blob = new Blob(
        [`# cert\n${data.certPem}\n# key\n${data.keyPem}`],
        { type: 'text/plain' }
      );
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${agent.hostname}-key.pem`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const genCmd = `openssl req -x509 -newkey rsa:2048 -keyout agent.key -out agent.crt \\
  -days 3650 -nodes -subj "/CN=${agent?.hostname || 'hostname'}/O=EDR"`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2E2F3A]">
          <div className="flex items-center gap-3">
            <Key size={18} className="text-[#FF2E63]" />
            <div>
              <h2 className="font-semibold text-white">Quản lý TLS Key</h2>
              <p className="text-xs text-gray-500">{agent?.hostname} · {agent?.ip}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition p-1 rounded">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#2E2F3A]">
          {['info', 'add'].map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); }}
              className={`px-5 py-3 text-sm font-medium transition border-b-2 -mb-px
                ${tab === t
                  ? 'text-white border-[#FF2E63]'
                  : 'text-gray-500 border-transparent hover:text-gray-300'}`}
            >
              {t === 'info' ? 'Trạng thái Key' : 'Thêm Key Mới'}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
              <AlertTriangle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          {/* ── Tab: Info ─────────────────────────────────────────────── */}
          {tab === 'info' && (
            <>
              {keyInfo === undefined && (
                <p className="text-gray-500 text-sm">Đang tải...</p>
              )}
              {keyInfo === null && (
                <div className="flex flex-col items-center gap-3 py-8 text-gray-500">
                  <Shield size={40} className="opacity-30" />
                  <p className="text-sm">Agent này chưa có key đăng ký.</p>
                  <button
                    onClick={() => setTab('add')}
                    className="flex items-center gap-2 text-sm px-4 py-2 bg-[#FF2E63]/10 hover:bg-[#FF2E63]/20 text-[#FF2E63] rounded-lg transition"
                  >
                    <Plus size={14} /> Thêm Key Ngay
                  </button>
                </div>
              )}
              {keyInfo && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Shield size={15} className="text-green-400" />
                    <span className="text-sm text-green-400 font-medium">Key đã đăng ký</span>
                  </div>

                  {keyInfo.label && (
                    <div className="text-sm text-gray-400">
                      <span className="text-gray-600">Label: </span>{keyInfo.label}
                    </div>
                  )}

                  {keyInfo.certInfo && (
                    <div className="bg-[#111217] rounded-lg p-4 space-y-2 text-sm font-mono">
                      <Row label="Subject"     value={keyInfo.certInfo.subject?.replace(/\n/g, ', ')} />
                      <Row label="Valid From"  value={keyInfo.certInfo.validFrom} />
                      <Row label="Valid To"    value={keyInfo.certInfo.validTo} />
                      <Row label="Fingerprint" value={keyInfo.certInfo.fingerprint} copy />
                    </div>
                  )}

                  <div className="text-xs text-gray-600">
                    Thêm bởi <span className="text-gray-500">{keyInfo.addedBy || '—'}</span> lúc{' '}
                    {new Date(keyInfo.addedAt).toLocaleString('vi-VN')}
                  </div>

                  {/* Cert PEM (public only) */}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-500 hover:text-gray-300 select-none">
                      Xem cert PEM (public)
                    </summary>
                    <pre className="mt-2 bg-[#111217] rounded p-3 text-gray-400 overflow-x-auto whitespace-pre-wrap break-all">
                      {keyInfo.certPem}
                    </pre>
                  </details>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="flex items-center gap-2 text-sm px-4 py-2 bg-[#25262E] hover:bg-[#2E2F3A] text-gray-300 rounded-lg transition disabled:opacity-50"
                    >
                      <Download size={14} /> {exporting ? 'Đang tải...' : 'Export cert+key'}
                    </button>
                    <button
                      onClick={handleDelete}
                      className="flex items-center gap-2 text-sm px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition"
                    >
                      <Trash2 size={14} /> Xóa Key
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Tab: Add ──────────────────────────────────────────────── */}
          {tab === 'add' && (
            <div className="space-y-5">
              {/* Generate hint */}
              <div className="bg-[#111217] rounded-lg p-4 space-y-2">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                  1. Sinh key pair trên máy agent (chạy lệnh sau):
                </p>
                <div className="flex items-start gap-2">
                  <pre className="flex-1 text-xs text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                    {genCmd}
                  </pre>
                  <CopyBtn text={genCmd} />
                </div>
                <p className="text-xs text-gray-600">
                  2. Upload file <code className="text-gray-400">agent.crt</code> và{' '}
                  <code className="text-gray-400">agent.key</code> bên dưới.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Label (tùy chọn)</label>
                <input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="vd: agent-web01 2025"
                  className="w-full bg-[#111217] border border-[#2E2F3A] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#FF2E63]/50"
                />
              </div>

              <PemFileInput
                label="Certificate PEM (file .crt hoặc .pem)"
                required
                accept=".pem,.crt,.cer"
                value={certPem}
                onChange={setCertPem}
              />

              <PemFileInput
                label="Private Key PEM (file .key hoặc .pem)"
                required
                accept=".pem,.key"
                value={keyPem}
                onChange={setKeyPem}
              />

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving || !certPem.trim() || !keyPem.trim()}
                  className="flex items-center gap-2 text-sm px-5 py-2 bg-[#FF2E63] hover:bg-[#FF2E63]/80 text-white rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                >
                  <Plus size={14} /> {saving ? 'Đang lưu...' : 'Lưu Key'}
                </button>
                <button
                  onClick={onClose}
                  className="text-sm px-4 py-2 bg-[#25262E] hover:bg-[#2E2F3A] text-gray-400 rounded-lg transition"
                >
                  Hủy
                </button>
              </div>

              {/* Agent-side instructions */}
              <div className="border-t border-[#2E2F3A] pt-4 space-y-2">
                <p className="text-xs text-gray-600 font-medium uppercase tracking-wide">
                  3. Cài key lên máy agent (sau khi lưu xong):
                </p>
                <pre className="text-xs text-gray-500 font-mono bg-[#111217] rounded p-3 whitespace-pre-wrap">{`# Copy cert+key vào thư mục certs của agent
python add_key.py --cert agent.crt --key agent.key

# Hoặc thủ công:
cp agent.crt ./certs/agent-cert.pem
cp agent.key  ./certs/agent-key.pem
chmod 600     ./certs/agent-key.pem`}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, copy }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-600 w-24 shrink-0">{label}</span>
      <span className="text-gray-300 flex-1 break-all">{value || '—'}</span>
      {copy && value && <CopyBtn text={value} />}
    </div>
  );
}
