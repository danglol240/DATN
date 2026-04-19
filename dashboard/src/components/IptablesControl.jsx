import { useState, useEffect } from 'react';
import { Shield, ShieldOff, Clock, CheckCircle, XCircle, Terminal } from 'lucide-react';
import { sendCommand } from '../hooks/useApi';
import { useCommandHistory, useAgents } from '../hooks/useApi';

const statusBadge = (status) => {
  if (status === 'done')
    return (
      <span className="flex items-center gap-1 text-green-400 text-xs">
        <CheckCircle size={12} /> done
      </span>
    );
  if (status === 'failed')
    return (
      <span className="flex items-center gap-1 text-red-500 text-xs font-bold">
        <XCircle size={12} /> failed
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-yellow-400 text-xs">
      <Clock size={12} /> pending
    </span>
  );
};

const actionBadge = (action) => {
  const map = {
    block_ip: 'bg-red-900/40 text-red-300',
    unblock_ip: 'bg-green-900/40 text-green-300',
    kill_process: 'bg-orange-900/40 text-orange-300',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono ${map[action] || 'bg-gray-700 text-gray-300'}`}>
      {action}
    </span>
  );
};

export default function IptablesControl({ prefilledAgentId }) {
  const { data: agents } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState('');
  
  // IPs Form State
  const [ip, setIp] = useState('');
  
  // Port Rule Form State
  const [chain, setChain] = useState('INPUT');
  const [protocol, setProtocol] = useState('tcp');
  const [port, setPort] = useState('');
  const [targetAction, setTargetAction] = useState('ACCEPT');
  
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (prefilledAgentId) setSelectedAgent(prefilledAgentId);
    else if (agents?.length && !selectedAgent) setSelectedAgent(agents[0].id);
  }, [prefilledAgentId, agents]);

  const agentId = selectedAgent;
  const { data: history, refetch } = useCommandHistory(agentId);

  const dispatch = async (actionName, e) => {
    if (e) e.preventDefault();
    if (!agentId) return setFeedback({ type: 'err', msg: 'Chưa có agent nào online' });
    
    let params = {};

    if (actionName === 'block_ip' || actionName === 'unblock_ip') {
      if (!ip.trim()) return setFeedback({ type: 'err', msg: 'Nhập địa chỉ IP trước' });
      params = { ip: ip.trim() };
    } else if (actionName === 'add_rule' || actionName === 'delete_rule') {
      if (!port.trim()) return setFeedback({ type: 'err', msg: 'Nhập Port trước' });
      params = { chain, protocol, port: port.trim(), target: targetAction };
    }
    
    setBusy(true);
    setFeedback(null);
    try {
      await sendCommand(agentId, actionName, params);
      setFeedback({ type: 'ok', msg: `Đã gửi lệnh "${actionName}" cho agent — đang thực thi...` });
      if (actionName.includes('ip')) setIp('');
      if (actionName.includes('rule')) setPort('');
      setTimeout(refetch, 2000);
    } catch (err) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] p-5 flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Terminal size={18} className="text-[#E8912E]" />
        <h2 className="text-white font-semibold text-sm tracking-wide">Firewall / iptables Control</h2>
        <span className="ml-auto text-xs text-gray-500">Backend → Agent (polling 10s)</span>
      </div>

      {!prefilledAgentId && (
        <div className="flex flex-col gap-1 w-full sm:w-auto">
          <label className="text-xs text-gray-400">Target Agent</label>
          <select
            className="bg-[#25262E] border border-[#3A3B45] text-white text-sm rounded-lg px-3 py-2 w-full max-w-sm focus:outline-none focus:border-[#E8912E]"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
          >
            {agents?.length ? (
              agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.hostname} — {a.id.slice(0, 8)}…
                </option>
              ))
            ) : (
              <option value="">Chưa có agent online</option>
            )}
          </select>
        </div>
      )}

      {/* Grid for Two Distinct Forms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* Form 1: IP Block / Unblock */}
        <div className="bg-[#1a1b20] p-4 rounded-xl border border-[#2E2F3A] flex flex-col gap-4 justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">IP Connections Management</h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">IP Address</label>
              <input
                type="text"
                placeholder="e.g. 192.168.1.50"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                className="bg-[#25262E] border border-[#3A3B45] text-white text-sm rounded-lg px-3 py-2.5 w-full font-mono focus:outline-none focus:border-[#E8912E]"
              />
            </div>
          </div>
          
          <div className="flex gap-2 mt-2">
            <button
              disabled={busy}
              onClick={() => dispatch('block_ip')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-700/80 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition"
            >
              <Shield size={16} /> Block IP
            </button>
            <button
              disabled={busy}
              onClick={() => dispatch('unblock_ip')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-800/80 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition"
            >
              <ShieldOff size={16} /> Unblock IP
            </button>
          </div>
        </div>

        {/* Form 2: Custom Rule */}
        <div className="bg-[#1a1b20] p-4 rounded-xl border border-[#2E2F3A] flex flex-col gap-4 justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Custom Port Rules</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Chain</label>
                <select value={chain} onChange={e => setChain(e.target.value)} className="bg-[#25262E] border border-[#3A3B45] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#E8912E]">
                  <option value="INPUT">INPUT</option>
                  <option value="FORWARD">FORWARD</option>
                  <option value="OUTPUT">OUTPUT</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Protocol</label>
                <select value={protocol} onChange={e => setProtocol(e.target.value)} className="bg-[#25262E] border border-[#3A3B45] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#E8912E]">
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Port</label>
                <input type="text" placeholder="e.g. 80" value={port} onChange={e => setPort(e.target.value)} className="bg-[#25262E] border border-[#3A3B45] text-white text-sm rounded-lg px-3 py-2 w-full font-mono focus:outline-none focus:border-[#E8912E]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Target Action</label>
                <select value={targetAction} onChange={e => setTargetAction(e.target.value)} className="bg-[#25262E] border border-[#3A3B45] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#E8912E]">
                  <option value="ACCEPT">ACCEPT</option>
                  <option value="DROP">DROP</option>
                  <option value="REJECT">REJECT</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 mt-2">
            <button
              disabled={busy}
              onClick={() => dispatch('add_rule')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#E8912E] hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium transition whitespace-nowrap"
            >
              <Shield size={16} /> Add Rule
            </button>
            <button
              disabled={busy}
              onClick={() => dispatch('delete_rule')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#3A3B45] hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-medium transition whitespace-nowrap"
            >
              <ShieldOff size={16} /> Delete Rule
            </button>
          </div>
        </div>

      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
            feedback.type === 'ok'
              ? 'bg-green-900/30 border border-green-700/40 text-green-300'
              : 'bg-red-900/30 border border-red-700/40 text-red-300'
          }`}
        >
          {feedback.type === 'ok' ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {feedback.msg}
        </div>
      )}

      <div>
        <p className="text-xs text-gray-300 font-semibold mb-2 uppercase tracking-wider">Command History (last 50)</p>
        <div className="overflow-auto max-h-52 rounded-xl border border-[#2E2F3A] bg-[#1C1D24] shadow-sm">
          <table className="w-full text-xs text-left text-gray-300">
            <thead className="bg-[#25262E] text-gray-400 sticky top-0 border-b border-[#3A3B45]">
              <tr>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Params</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Sent</th>
                <th className="px-4 py-3 font-semibold">Done at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2E2F3A]">
              {history?.length ? (
                history.map((cmd) => (
                  <tr key={cmd.id} className="hover:bg-[#25262E]/50 transition-colors group">
                    <td className="px-4 py-3">{actionBadge(cmd.action)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#00E5FF]">{cmd.params}</td>
                    <td className="px-4 py-3">{statusBadge(cmd.status)}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(cmd.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {cmd.doneAt ? new Date(cmd.doneAt).toLocaleTimeString() : '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    Chưa có lệnh nào được gửi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
