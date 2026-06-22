import React, { useState, useEffect } from 'react';
import { X, Wifi, WifiOff, Cpu, MemoryStick, Network, Terminal, Clock, Globe } from 'lucide-react';
import { useCommandHistory } from '../hooks/useApi';

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function GaugeBar({ value, label, icon }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color =
    pct >= 90 ? 'bg-red-500' :
    pct >= 70 ? 'bg-amber-500' :
    'bg-emerald-500';
  const textColor =
    pct >= 90 ? 'text-red-400' :
    pct >= 70 ? 'text-amber-400' :
    'text-emerald-400';

  return (
    <div className="bg-[#25262E] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-400 text-sm font-medium">
          {icon}
          {label}
        </div>
        <span className={`text-2xl font-bold font-mono ${textColor}`}>
          {value != null ? `${pct.toFixed(1)}%` : '—'}
        </span>
      </div>
      <div className="w-full bg-[#111217] rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500">
        {pct >= 90 ? 'Critical — high usage' :
         pct >= 70 ? 'Elevated usage' :
         'Normal'}
      </p>
    </div>
  );
}

function CommandStatusBadge({ status }) {
  const map = {
    completed:   'text-green-400 bg-green-400/10',
    in_progress: 'text-blue-400 bg-blue-400/10',
    pending:     'text-amber-400 bg-amber-400/10',
    failed:      'text-red-400 bg-red-400/10',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'text-gray-400 bg-gray-400/10'}`}>
      {status}
    </span>
  );
}

export default function AgentHealthModal({ agent, onClose }) {
  const [tick, setTick] = useState(0);
  const { data: commands } = useCommandHistory(agent?.id);

  // Live "X seconds ago" counter
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!agent) return null;

  const isOnline = agent.status === 'online';

  // Parse network interfaces
  let interfaces = [];
  try {
    const raw = JSON.parse(agent.interfaces || '[]');
    interfaces = Array.isArray(raw) ? raw : Object.entries(raw).map(([name, addrs]) => ({ name, addrs }));
  } catch {}

  const recentCommands = (commands || []).slice(0, 6);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg h-full bg-[#1C1D24] border-l border-[#2E2F3A] shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#2E2F3A] bg-[#25262E]">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-400 shadow-[0_0_6px_#4ade80]' : 'bg-red-400'} mt-0.5`} />
              <h2 className="text-lg font-bold text-white uppercase tracking-wide">{agent.hostname}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isOnline ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500 ml-6">
              <span className="flex items-center gap-1"><Globe size={11} /> {agent.ip}</span>
              {agent.url && <span className="flex items-center gap-1"><Wifi size={11} /> {agent.url}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#3A3B45] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Last heartbeat */}
          <div className="flex items-center gap-2 text-sm text-gray-400 bg-[#25262E] rounded-lg px-4 py-2.5">
            <Clock size={14} className="text-gray-500" />
            <span>Last heartbeat:</span>
            <span className={`font-medium ${isOnline ? 'text-green-400' : 'text-red-400'}`}>
              {agent.lastHeartbeat ? timeAgo(agent.lastHeartbeat) : '—'}
            </span>
            <span className="ml-auto text-gray-600 text-xs">
              {agent.lastHeartbeat ? new Date(agent.lastHeartbeat).toLocaleString() : ''}
            </span>
          </div>

          {/* CPU + Memory gauges */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Resource Usage</h3>
            <div className="grid grid-cols-2 gap-3">
              <GaugeBar value={agent.cpuPercent} label="CPU" icon={<Cpu size={14} />} />
              <GaugeBar value={agent.memPercent} label="Memory" icon={<MemoryStick size={14} />} />
            </div>
          </div>

          {/* Network Interfaces */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Network size={12} /> Network Interfaces
            </h3>
            {interfaces.length > 0 ? (
              <div className="bg-[#25262E] rounded-xl overflow-hidden border border-[#3A3B45]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#3A3B45] text-xs text-gray-500">
                      <th className="px-4 py-2.5 text-left font-medium">Interface</th>
                      <th className="px-4 py-2.5 text-left font-medium">Addresses</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#3A3B45]">
                    {interfaces.map((iface, i) => {
                      const name = iface.name || iface.iface || Object.keys(iface)[0] || `iface-${i}`;
                      const addrs = iface.addrs || iface.addresses || iface[name] || [];
                      const addrList = Array.isArray(addrs) ? addrs : [addrs];
                      return (
                        <tr key={i} className="hover:bg-[#1C1D24]/60">
                          <td className="px-4 py-2.5 font-mono text-blue-300 font-medium">{name}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col gap-0.5">
                              {addrList.length > 0
                                ? addrList.map((addr, j) => (
                                    <span key={j} className="font-mono text-xs text-gray-300">
                                      {typeof addr === 'string' ? addr : addr.addr || addr.address || JSON.stringify(addr)}
                                    </span>
                                  ))
                                : <span className="text-gray-600 text-xs">—</span>
                              }
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-[#25262E] rounded-xl px-4 py-6 text-center text-gray-600 text-sm border border-[#3A3B45]">
                No interface data — waiting for next heartbeat
              </div>
            )}
          </div>

          {/* Command History */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Terminal size={12} /> Recent Commands
            </h3>
            {recentCommands.length > 0 ? (
              <div className="bg-[#25262E] rounded-xl overflow-hidden border border-[#3A3B45] divide-y divide-[#3A3B45]">
                {recentCommands.map(cmd => (
                  <div key={cmd.id} className="flex items-center justify-between px-4 py-3 hover:bg-[#1C1D24]/60">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-mono text-gray-200">{cmd.action}</span>
                      <span className="text-xs text-gray-500">{timeAgo(cmd.createdAt)}</span>
                    </div>
                    <CommandStatusBadge status={cmd.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-[#25262E] rounded-xl px-4 py-6 text-center text-gray-600 text-sm border border-[#3A3B45]">
                No commands sent yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
