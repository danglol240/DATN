import React from 'react';
import { Settings, X, Layers } from 'lucide-react';

export default function BatchRuleModal({ selectedCount, onSubmit, onCancel }) {
  const [rule, setRule] = React.useState({
    chain:     'INPUT',
    priority:  '',
    action:    'DROP',
    disabled:  false,
    protocol:  'tcp',
    port:      '',
    src:       '',
    srcType:   'any',
    srcMask:   '',
    srcInvert: false,
    sport:     '',
    dst:       '',
    dstType:   'any',
    dstMask:   '',
    dstInvert: false,
    states:    [],
    log:       false,
    logPrefix: '',
  });
  const [showAdvancedSource, setShowAdvancedSource] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (['tcp', 'udp', 'tcp/udp'].includes(rule.protocol) && !rule.port.trim())
      return alert('Port là bắt buộc với TCP/UDP.');
    if (rule.disabled) { alert('Rule đang bị disabled, bỏ qua.'); return; }
    setIsSubmitting(true);
    try {
      await onSubmit(rule);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-[#1C1D24]/90 backdrop-blur-sm border border-[#2E2F3A] rounded-md shadow-2xl w-full max-w-4xl overflow-hidden text-sm">

        {/* Header */}
        <div className="bg-[#25262E]/90 px-6 py-4 border-b border-[#3A3B45] flex items-center justify-between">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Layers size={16} className="text-blue-400" />
            Push Iptables Rule — {selectedCount} Devices
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#3A3B45]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>

          {/* ── Section 1 ─────────────────────────────────────────── */}
          <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white">
            Edit Firewall Rule
          </div>

          {/* Chain */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Chain</div>
            <div className="p-4 bg-[#21222C]/70">
              <select value={rule.chain} onChange={e => setRule({...rule, chain: e.target.value})}
                className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]">
                <option value="INPUT">INPUT</option>
                <option value="FORWARD">FORWARD</option>
                <option value="OUTPUT">OUTPUT</option>
              </select>
              <p className="text-gray-500 text-xs mt-1">Chain mà rule này sẽ được thêm vào.</p>
            </div>
          </div>

          {/* Priority */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Rule Order (Priority)</div>
            <div className="p-4 bg-[#21222C]/70">
              <input type="number" value={rule.priority || ''}
                onChange={e => setRule({...rule, priority: e.target.value})}
                placeholder="e.g. 1 (Lowest number = Highest priority)"
                className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]" />
              <p className="text-gray-500 text-xs mt-1">Thứ tự ưu tiên (1 = ưu tiên cao nhất). Để trống để thêm vào cuối.</p>
            </div>
          </div>

          {/* Action */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Action</div>
            <div className="p-4 bg-[#21222C]/70">
              <select value={rule.action} onChange={e => setRule({...rule, action: e.target.value})}
                className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]">
                <option value="ACCEPT">ACCEPT</option>
                <option value="DROP">DROP</option>
                <option value="REJECT">REJECT</option>
              </select>
              <p className="text-gray-500 text-xs mt-1 max-w-3xl">
                Hành động áp dụng cho packet khớp với rule này.<br />
                Hint: DROP loại bỏ packet im lặng, REJECT gửi phản hồi lỗi về cho người gửi.
              </p>
            </div>
          </div>

          {/* Disabled */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Disabled</div>
            <div className="p-4 bg-[#21222C]/70">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rule.disabled || false}
                  onChange={e => setRule({...rule, disabled: e.target.checked})}
                  className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" />
                <span className="text-gray-300">Disable this rule</span>
              </label>
              <p className="text-gray-500 text-xs mt-1">Tắt rule này mà không xóa khỏi danh sách.</p>
            </div>
          </div>

          {/* Protocol */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Protocol</div>
            <div className="p-4 bg-[#21222C]/70">
              <select value={rule.protocol} onChange={e => setRule({...rule, protocol: e.target.value})}
                className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]">
                <option value="all">Any</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="icmpv6">ICMPv6</option>
                <option value="sctp">SCTP</option>
                <option value="udplite">UDPLite</option>
                <option value="esp">ESP</option>
                <option value="ah">AH</option>
                <option value="mh">MH</option>
                <option value="47">GRE (47)</option>
              </select>
              <p className="text-gray-500 text-xs mt-1">Giao thức IP mà rule này áp dụng.</p>
            </div>
          </div>

          {/* ── Section 2 ─────────────────────────────────────────── */}
          <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white mt-4 border-t">
            Source
          </div>

          {/* Source */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white">Source</div>
            <div className="p-4 bg-[#21222C]/70">
              <div className="flex gap-4 items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={rule.srcInvert || false}
                    onChange={e => setRule({...rule, srcInvert: e.target.checked})}
                    className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" />
                  <span className="text-gray-300">Invert match</span>
                </label>
                <select value={rule.srcType || 'any'} onChange={e => setRule({...rule, srcType: e.target.value})}
                  className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none">
                  <option value="any">any</option>
                  <option value="single">Single host or alias</option>
                  <option value="network">Network</option>
                </select>
                <input type="text" value={rule.src || ''}
                  onChange={e => setRule({...rule, src: e.target.value})}
                  disabled={rule.srcType === 'any'}
                  placeholder="Source Address"
                  className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 flex-1 focus:outline-none ${rule.srcType === 'any' ? 'opacity-50 cursor-not-allowed' : ''}`} />
                <input type="text" value={rule.srcMask || ''}
                  onChange={e => setRule({...rule, srcMask: e.target.value})}
                  disabled={rule.srcType === 'any' || rule.srcType === 'single'}
                  placeholder="/"
                  className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-16 focus:outline-none ${rule.srcType === 'any' || rule.srcType === 'single' ? 'opacity-50 cursor-not-allowed' : ''}`} />
              </div>
              {!showAdvancedSource && (
                <button type="button" onClick={() => setShowAdvancedSource(true)}
                  className="mt-4 bg-blue-600/80 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5">
                  <Settings size={14} /> Display Advanced
                </button>
              )}
              <p className="text-gray-500 text-xs mt-2 max-w-3xl">Địa chỉ IP nguồn. Chọn <strong>any</strong> để khớp tất cả.</p>
            </div>
          </div>

          {/* Source Port Range (Advanced) */}
          {showAdvancedSource && (
            <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
              <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Source Port Range</div>
              <div className="p-4 bg-[#21222C]/70">
                <div className="flex gap-4 items-center mb-2">
                  <span className="text-gray-400 min-w-10 text-right">From</span>
                  <select className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none">
                    <option>Custom</option>
                  </select>
                  <span className="text-gray-400 min-w-10 text-right">To</span>
                  <select className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none">
                    <option>Custom</option>
                  </select>
                </div>
                <div className="flex gap-4 items-center mb-2">
                  <div className="min-w-10"></div>
                  <input type="text" value={rule.sport || ''}
                    onChange={e => setRule({...rule, sport: e.target.value})}
                    disabled={!['tcp', 'udp', 'tcp/udp'].includes(rule.protocol)}
                    placeholder={['tcp', 'udp', 'tcp/udp'].includes(rule.protocol) ? '' : 'N/A for ' + (rule.protocol || 'this protocol')}
                    className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none focus:border-[#E8912E] font-mono ${!['tcp', 'udp', 'tcp/udp'].includes(rule.protocol) ? 'opacity-50 cursor-not-allowed' : ''}`} />
                </div>
                <p className="text-gray-500 text-xs mt-2">Port nguồn hoặc dải port của packet.</p>
              </div>
            </div>
          )}

          {/* ── Section 3 ─────────────────────────────────────────── */}
          <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white mt-4 border-t">
            Destination
          </div>

          {/* Destination */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white">Destination</div>
            <div className="p-4 bg-[#21222C]/70">
              <div className="flex gap-4 items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={rule.dstInvert || false}
                    onChange={e => setRule({...rule, dstInvert: e.target.checked})}
                    className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" />
                  <span className="text-gray-300">Invert match</span>
                </label>
                <select value={rule.dstType || 'any'} onChange={e => setRule({...rule, dstType: e.target.value})}
                  className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none">
                  <option value="any">any</option>
                  <option value="single">Single host or alias</option>
                  <option value="network">Network</option>
                </select>
                <input type="text" value={rule.dst || ''}
                  onChange={e => setRule({...rule, dst: e.target.value})}
                  disabled={rule.dstType === 'any'}
                  placeholder="Destination Address"
                  className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 flex-1 focus:outline-none ${rule.dstType === 'any' ? 'opacity-50 cursor-not-allowed' : ''}`} />
                <input type="text" value={rule.dstMask || ''}
                  onChange={e => setRule({...rule, dstMask: e.target.value})}
                  disabled={rule.dstType === 'any' || rule.dstType === 'single'}
                  placeholder="/"
                  className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-16 focus:outline-none ${rule.dstType === 'any' || rule.dstType === 'single' ? 'opacity-50 cursor-not-allowed' : ''}`} />
              </div>
              <p className="text-gray-500 text-xs mt-2 max-w-3xl">Địa chỉ IP đích. Chọn <strong>any</strong> để khớp tất cả.</p>
            </div>
          </div>

          {/* Destination Port Range */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Destination Port Range</div>
            <div className="p-4 bg-[#21222C]/70">
              <div className="flex gap-4 items-center mb-2">
                <span className="text-gray-400 min-w-10 text-right">From</span>
                <select className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none">
                  <option>Custom</option>
                </select>
                <span className="text-gray-400 min-w-10 text-right">To</span>
                <select className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none">
                  <option>Custom</option>
                </select>
              </div>
              <div className="flex gap-4 items-center mb-2">
                <div className="min-w-10"></div>
                <input type="text" value={rule.port || ''}
                  onChange={e => setRule({...rule, port: e.target.value})}
                  disabled={!['tcp', 'udp', 'tcp/udp'].includes(rule.protocol)}
                  placeholder={['tcp', 'udp', 'tcp/udp'].includes(rule.protocol) ? '' : 'N/A for ' + (rule.protocol || 'this protocol')}
                  className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none focus:border-[#E8912E] font-mono ${!['tcp', 'udp', 'tcp/udp'].includes(rule.protocol) ? 'opacity-50 cursor-not-allowed' : ''}`} />
              </div>
              <p className="text-gray-500 text-xs mt-2">Port đích hoặc dải port. Để trống nếu không lọc theo port.</p>
            </div>
          </div>

          {/* ── Section 4 ─────────────────────────────────────────── */}
          <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white mt-4 border-t">
            Extra Options
          </div>

          {/* State */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">State</div>
            <div className="p-4 bg-[#21222C]/70">
              <div className="flex gap-6 items-center">
                {['NEW', 'ESTABLISHED', 'RELATED', 'INVALID'].map(s => (
                  <label key={s} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox"
                      checked={rule.states?.includes(s) || false}
                      onChange={e => {
                        const st = new Set(rule.states || []);
                        if (e.target.checked) st.add(s); else st.delete(s);
                        setRule({...rule, states: Array.from(st)});
                      }}
                      className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" />
                    <span className="text-gray-300 text-sm">{s}</span>
                  </label>
                ))}
              </div>
              <p className="text-gray-500 text-xs mt-2 max-w-4xl">Lọc theo trạng thái kết nối. Mặc định khớp tất cả trạng thái.</p>
            </div>
          </div>

          {/* Log */}
          <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
            <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Log</div>
            <div className="p-4 bg-[#21222C]/70">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rule.log || false}
                  onChange={e => setRule({...rule, log: e.target.checked})}
                  className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" />
                <span className="text-gray-300">Log packets that are handled by this rule</span>
              </label>
              {rule.log && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-gray-400 text-sm whitespace-nowrap">Log Prefix:</span>
                  <input type="text" value={rule.logPrefix || ''}
                    onChange={e => setRule({...rule, logPrefix: e.target.value})}
                    placeholder={`FW_LOG_${rule.action || 'RULE'}:`}
                    maxLength={29}
                    className="bg-[#1C1D24] border border-[#3A3B45] text-white text-sm rounded px-3 py-1.5 w-64 focus:outline-none focus:border-[#E8912E] font-mono text-xs" />
                </div>
              )}
              <p className="text-gray-500 text-xs mt-3 max-w-4xl">
                Ghi log các packet khớp rule này. Hạn chế bật log cho nhiều rule cùng lúc.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-[#25262E]/80 p-4 flex gap-3 justify-center border-t border-[#3A3B45] mt-4">
            <button type="submit" disabled={isSubmitting}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded shadow disabled:opacity-50 transition font-medium flex items-center gap-2 text-sm">
              {isSubmitting ? 'Dispatching…' : `Dispatch to ${selectedCount} Devices`}
            </button>
            <button type="button" onClick={onCancel}
              className="px-6 py-2 bg-gray-600/80 hover:bg-gray-500 text-white rounded shadow transition font-medium text-sm">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
