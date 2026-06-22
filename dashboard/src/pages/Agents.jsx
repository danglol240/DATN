import React, { useState, useEffect, useRef, useMemo } from 'react';
import IptablesControl from '../components/IptablesControl';
import EditRule from '../components/EditRule';
import BatchProgress from '../components/BatchProgress';
import BatchRuleModal from '../components/BatchRuleModal';
import AgentKeyModal from '../components/AgentKeyModal';
import AgentHealthModal from '../components/AgentHealthModal';
import { useAgents } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { Monitor, Search, MoreVertical, LayoutGrid, Users, ShieldAlert, ArrowLeft, RefreshCw, Trash2, Plus, Settings, X, Layers, Key } from 'lucide-react';

import { sendCommand, sendCommandBatch } from '../hooks/useApi';

function MiniBar({ value, label }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color =
    pct >= 90 ? 'bg-red-500' :
    pct >= 70 ? 'bg-amber-500' :
    'bg-emerald-500';
  const textColor =
    pct >= 90 ? 'text-red-400' :
    pct >= 70 ? 'text-amber-400' :
    'text-emerald-400';
  if (value == null) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <div className="flex flex-col gap-1 min-w-[72px]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">{label}</span>
        <span className={`text-xs font-mono font-semibold ${textColor}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="w-full bg-[#111217] rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Agents() {
  const { data: fetchedAgents, refetch: refetchAgents } = useAgents();
  const { on } = useSocket();

  // liveAgents = fetchedAgents seeded on load, then patched in real-time via socket
  const [liveAgents, setLiveAgents] = useState(null);
  useEffect(() => {
    if (fetchedAgents) setLiveAgents(fetchedAgents);
  }, [fetchedAgents]);

  const agents = liveAgents;

  // Socket real-time patches
  useEffect(() => {
    const offMetrics = on('agent_metrics', (data) => {
      setLiveAgents(prev => prev ? prev.map(a =>
        a.id === data.agentId
          ? {
              ...a,
              cpuPercent:   data.cpu_percent,
              memPercent:   data.memory_percent,
              lastHeartbeat: new Date().toISOString(),
              iptablesRules: data.iptables_rules ?? a.iptablesRules,
              interfaces:    data.network_interfaces ? JSON.stringify(data.network_interfaces) : a.interfaces,
              status: 'online',
            }
          : a
      ) : prev);
    });

    const offConn = on('agent_connected', ({ agentId }) => {
      setLiveAgents(prev => prev ? prev.map(a =>
        a.id === agentId ? { ...a, status: 'online' } : a
      ) : prev);
    });

    const offDisconn = on('agent_disconnected', ({ agentId }) => {
      setLiveAgents(prev => prev ? prev.map(a =>
        a.id === agentId ? { ...a, status: 'offline' } : a
      ) : prev);
    });

    return () => { offMetrics(); offConn(); offDisconn(); };
  }, [on]);

  const [view, setView] = useState('list'); // 'list' | 'iptables' | 'edit-rule'
  const [activeAgent, setActiveAgent] = useState(null);
  const [filterChain, setFilterChain] = useState('INPUT');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [openMenuId, setOpenMenuId] = useState(null);

  // Batch selection
  const [selectedAgentIds, setSelectedAgentIds] = useState(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchJobInfo, setBatchJobInfo] = useState(null); // { batchJobId, total, initialSuccess, initialFailed }

  // States for Add Rule Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRule, setNewRule] = useState({ action: 'ACCEPT', protocol: 'tcp', port: '' });

  // State for Key Management Modal
  const [keyModalAgent, setKeyModalAgent] = useState(null);
  const [healthModalAgent, setHealthModalAgent] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Keep activeAgent and healthModalAgent in sync when liveAgents updates
  useEffect(() => {
    if (!agents) return;
    if (activeAgent) {
      const updated = agents.find(a => a.id === activeAgent.id);
      if (updated) setActiveAgent(updated);
    }
    if (healthModalAgent) {
      const updated = agents.find(a => a.id === healthModalAgent.id);
      if (updated) setHealthModalAgent(updated);
    }
  }, [agents, activeAgent?.id, healthModalAgent?.id]);

  const menuRef = useRef();

  const availableChains = useMemo(() => {
    if (!activeAgent || !activeAgent.iptablesRules) return ['INPUT', 'FORWARD', 'OUTPUT'];
    const matches = [...activeAgent.iptablesRules.matchAll(/Chain (\S+)/g)];
    return matches.length > 0 ? matches.map(m => m[1]) : ['INPUT', 'FORWARD', 'OUTPUT'];
  }, [activeAgent?.iptablesRules]);

  useEffect(() => {
    if (activeAgent && !availableChains.includes(filterChain)) {
      setFilterChain(availableChains[0] || 'INPUT');
    }
  }, [activeAgent, availableChains]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const parsedRules = useMemo(() => {
    if (!activeAgent || !activeAgent.iptablesRules) return [];
    const text   = activeAgent.iptablesRules;
    const chains = text.split(/(?=Chain \w+)/);

    let targetChainStr = chains.find(c => c.startsWith(`Chain ${filterChain}`));
    if (!targetChainStr) return [];

    let lines = targetChainStr.split('\n').map(l => l.trim()).filter(Boolean);
    lines = lines.filter(l => !l.startsWith('Chain') && !l.startsWith('num'));

    return lines.map(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 6) return { raw: line };
      return {
        num:         parts[0],
        target:      parts[1],
        prot:        parts[2],
        opt:         parts[3],
        source:      parts[4],
        destination: parts[5],
        extra:       parts.slice(6).join(' '),
        raw:         line,
      };
    });
  }, [activeAgent?.iptablesRules, filterChain]);

  const chainPolicy = useMemo(() => {
    if (!activeAgent?.iptablesRules) return null;
    const match = activeAgent.iptablesRules.match(
      new RegExp(`Chain ${filterChain} \\(policy (\\w+)`)
    );
    return match ? match[1] : null;
  }, [activeAgent?.iptablesRules, filterChain]);

  const handleDeleteRule = async (num) => {
    if (!confirm(`Are you sure you want to delete Rule #${num}?`)) return;
    try {
      await sendCommand(activeAgent.id, 'delete_rule', { chain: filterChain, num });
      alert('Delete command queued. Wait a few seconds for the agent to process it, then click Reload.');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleAddRuleSubmit = async (e) => {
    e.preventDefault();
    if (['tcp', 'udp', 'tcp/udp'].includes(newRule.protocol) && !newRule.port.trim())
      return alert('Please enter a Port for TCP/UDP.');
    if (newRule.disabled) { alert('Rule is disabled, skipped adding to iptables.'); return; }
    setIsSubmitting(true);
    try {
      await sendCommand(activeAgent.id, 'add_rule', {
        chain:     filterChain,
        priority:  newRule.priority,
        protocol:  newRule.protocol,
        port:      newRule.port,
        target:    newRule.action,
        log:       newRule.log || false,
        logPrefix: newRule.logPrefix || `FW_LOG_${newRule.action || 'RULE'}: `,
        states:    newRule.states || [],
        srcType:   newRule.srcType,
        src:       newRule.src,
        srcMask:   newRule.srcMask,
        srcInvert: newRule.srcInvert,
        sport:     newRule.sport,
        dstType:   newRule.dstType,
        dst:       newRule.dst,
        dstMask:   newRule.dstMask,
        dstInvert: newRule.dstInvert,
      });
      alert(`Successfully sent instruction to add rule to ${filterChain}. Wait a few seconds then reload.`);
      setShowAddModal(false);
      setNewRule({ action: 'ACCEPT', protocol: 'tcp', port: '' });
    } catch (err) {
      alert('Failed to add rule: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── iptables view ──────────────────────────────────────────────────────────
  if (view === 'iptables' && activeAgent) {
    return (
      <div className="p-6 pb-20 max-w-[1400px] mx-auto space-y-6">
        <button
          onClick={() => setView('list')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors w-fit px-3 py-2 rounded-lg hover:bg-[#25262E] -ml-3"
        >
          <ArrowLeft size={16}/> Back to Devices
        </button>

        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-white">
            Firewall Rules: {activeAgent.hostname}
          </h1>
        </header>

        {/* Chain tabs */}
        <div className="flex items-center gap-6 border-b border-[#2E2F3A] mb-4 overflow-x-auto">
          {availableChains.map(chain => {
            const pm = activeAgent?.iptablesRules?.match(new RegExp(`Chain ${chain} \\(policy (\\w+)`));
            const policy = pm ? pm[1] : null;
            return (
              <button
                key={chain}
                onClick={() => setFilterChain(chain)}
                className={`pb-3 px-1 border-b-2 transition-colors font-medium text-sm whitespace-nowrap flex items-center gap-2 ${filterChain === chain ? 'border-[#E8912E] text-[#E8912E]' : 'border-transparent text-gray-400 hover:text-gray-300'}`}
              >
                {chain}
                {policy && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    policy === 'ACCEPT' ? 'bg-green-500/15 text-green-400 border border-green-500/30' :
                    policy === 'DROP'   ? 'bg-red-500/15 text-red-400 border border-red-500/30' :
                    'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                  }`}>{policy}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] shadow-md overflow-hidden">
          <div className="flex items-center justify-between p-4 bg-[#25262E] border-b border-[#3A3B45]">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-gray-300">Rules (Drag to Change Order)</h2>
              {chainPolicy && (
                <span className="flex items-center gap-1 text-xs">
                  <span className="text-gray-500">Default Policy:</span>
                  <span className={`font-bold px-2 py-0.5 rounded ${
                    chainPolicy === 'ACCEPT' ? 'bg-green-500/15 text-green-400 border border-green-500/30' :
                    chainPolicy === 'DROP'   ? 'bg-red-500/15 text-red-400 border border-red-500/30' :
                    'bg-gray-500/15 text-gray-300 border border-gray-500/30'
                  }`}>{chainPolicy}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 bg-[#111217] px-3 py-1.5 rounded-md border border-[#3A3B45]">
                Updated: {new Date(activeAgent.lastHeartbeat).toLocaleTimeString()}
              </span>
              <button
                onClick={() => refetchAgents()}
                className="flex items-center gap-1.5 text-xs bg-[#111217] hover:bg-gray-800 text-gray-300 px-3 py-1.5 rounded-md border border-[#3A3B45] transition-colors"
              >
                <RefreshCw size={14} /> Reload
              </button>
            </div>
          </div>

          <div className="overflow-x-auto min-h-[250px]">
            <table className="w-full text-left text-sm text-gray-300">
              <thead className="text-xs text-gray-400 border-b border-[#3A3B45]">
                <tr>
                  <th className="px-4 py-3 w-10">Num</th>
                  <th className="px-4 py-3">Protocol</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Options/Port</th>
                  <th className="px-4 py-3">Action (Target)</th>
                  <th className="px-4 py-3 w-28 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#3A3B45]">
                {parsedRules.length > 0 ? parsedRules.map((rule, idx) => (
                  <tr key={idx} className="hover:bg-[#25262E]/70 transition-colors">
                    <td className="px-4 py-3 font-mono text-gray-500">{rule.num}</td>
                    <td className="px-4 py-3 text-yellow-400 font-mono">{rule.prot}</td>
                    <td className="px-4 py-3 text-cyan-400 font-mono">{rule.source}</td>
                    <td className="px-4 py-3 text-cyan-400 font-mono">{rule.destination}</td>
                    <td className="px-4 py-3 text-purple-400 font-mono">{rule.extra || '*'}</td>
                    <td className="px-4 py-3 font-bold">
                      <span className={`px-2 py-1 rounded-sm text-xs ${
                        rule.target === 'ACCEPT' ? 'text-green-500 bg-green-500/10' :
                        rule.target === 'DROP'   ? 'text-red-500 bg-red-500/10' :
                        'text-gray-300'
                      }`}>{rule.target}</span>
                    </td>
                    <td className="px-4 py-3 flex items-center justify-center gap-2">
                      <button
                        onClick={() => setView('edit-rule')}
                        className="text-gray-500 hover:text-blue-400 p-1" title="Edit"
                      ><Settings size={16} /></button>
                      <button
                        onClick={() => handleDeleteRule(rule.num)}
                        className="text-gray-500 hover:text-red-400 p-1" title="Delete"
                      ><Trash2 size={16} /></button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="7" className="px-4 py-16 text-center text-gray-500">
                      Không có rule nào ở Chain này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 justify-end p-4 border-t border-[#3A3B45] bg-[#25262E]">
            <button
              onClick={() => { setShowAddModal(false); setView('edit-rule'); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded shadow transition-colors"
            >
              <Plus size={16} /> Add Rule
            </button>
          </div>
        </div>

        <div className="mt-8 opacity-60">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 bg-[#25262E] inline-block px-4 py-1.5 rounded-md border border-[#3A3B45]">
            Quick Policy Add / Block IPs
          </h3>
          <IptablesControl prefilledAgentId={activeAgent.id} />
        </div>
      </div>
    );
  }

  if (view === 'edit-rule' && activeAgent) {
    return (
      <EditRule
        agent={activeAgent}
        filterChain={filterChain}
        newRule={newRule}
        setNewRule={setNewRule}
        isSubmitting={isSubmitting}
        onSubmit={handleAddRuleSubmit}
        onCancel={() => { setView('iptables'); setShowAddModal(false); }}
      />
    );
  }

  // ── agent list view ────────────────────────────────────────────────────────
  const filteredAgents = agents?.filter(a => {
    const matchesSearch = a.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || a.ip.includes(searchQuery);
    const matchesStatus = filterStatus === 'All' || a.status.toLowerCase() === filterStatus.toLowerCase();
    return matchesSearch && matchesStatus;
  }) || [];

  const toggleSelectAgent = (agentId) => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  };

  const toggleSelectAll = (e) => {
    setSelectedAgentIds(e.target.checked ? new Set(filteredAgents.map(a => a.id)) : new Set());
  };

  const handleBatchSubmit = async (rule) => {
    try {
      const result = await sendCommandBatch(Array.from(selectedAgentIds), 'add_rule', {
        chain:     rule.chain,
        priority:  rule.priority,
        protocol:  rule.protocol,
        port:      rule.port,
        target:    rule.action,
        log:       rule.log || false,
        logPrefix: rule.logPrefix || `FW_LOG_${rule.action}: `,
        states:    rule.states || [],
        srcType:   rule.srcType,
        src:       rule.src,
        srcMask:   rule.srcMask,
        srcInvert: rule.srcInvert,
        sport:     rule.sport,
        dstType:   rule.dstType,
        dst:       rule.dst,
        dstMask:   rule.dstMask,
        dstInvert: rule.dstInvert,
      });

      setBatchJobInfo({
        batchJobId:     result.batchJobId,
        total:          selectedAgentIds.size,
        initialSuccess: result.dispatched,
        initialFailed:  result.errors?.length || 0,
      });

      setShowBatchModal(false);
      setSelectedAgentIds(new Set());
    } catch (err) {
      alert('Batch dispatch failed: ' + err.message);
    }
  };

  return (
    <div className="p-6 pb-20 max-w-[1400px] mx-auto space-y-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <Monitor size={22} className="text-blue-500" /> Devices
        </h1>
      </header>

      <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] shadow-md min-h-[500px]">
        {/* Toolbar */}
        <div className="p-4 border-b border-[#2E2F3A] flex gap-4 items-center">
          <div className="relative flex-1 max-w-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={16} className="text-gray-500" />
            </div>
            <input
              type="text"
              placeholder="Search Devices"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#111217] border border-[#3A3B45] text-gray-200 text-sm rounded-md pl-10 pr-4 py-2 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-[#111217] border border-[#3A3B45] text-gray-300 text-sm rounded-md px-3 py-2 w-32 focus:outline-none focus:border-blue-500 appearance-none"
          >
            <option value="All">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>

          <div className="ml-auto">
            <button className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-[#25262E] transition-colors border border-[#3A3B45]">
              <LayoutGrid size={18} />
            </button>
          </div>
        </div>

        {/* Batch actions bar */}
        {selectedAgentIds.size >= 2 && (
          <div className="px-4 py-2.5 bg-blue-600/15 border-b border-blue-500/30 flex items-center gap-4">
            <span className="text-blue-300 text-sm font-medium flex items-center gap-2">
              <Layers size={15} /> {selectedAgentIds.size} devices selected
            </span>
            <button
              onClick={() => setShowBatchModal(true)}
              className="ml-auto flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors"
            >
              <Plus size={14} /> Push Iptables Rule
            </button>
            <button
              onClick={() => setSelectedAgentIds(new Set())}
              className="text-gray-400 hover:text-white text-xs px-2 py-1.5 rounded hover:bg-[#3A3B45] transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-visible">
          <table className="w-full text-left text-sm text-gray-300">
            <thead className="text-gray-400 border-b border-[#2E2F3A]">
              <tr>
                <th className="px-5 py-4 w-12">
                  <input type="checkbox" className="rounded bg-[#111217] border-[#3A3B45] accent-blue-500"
                    checked={filteredAgents.length > 0 && selectedAgentIds.size === filteredAgents.length}
                    onChange={toggleSelectAll} />
                </th>
                <th className="px-4 py-4 font-medium">Device Names</th>
                <th className="px-4 py-4 font-medium">IP</th>
                <th className="px-4 py-4 font-medium">CPU</th>
                <th className="px-4 py-4 font-medium">Memory</th>
                <th className="px-4 py-4 font-medium">Last Seen</th>
                <th className="px-4 py-4 font-medium">Status</th>
                <th className="px-4 py-4 font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2E2F3A]">
              {filteredAgents.length ? filteredAgents.map(a => (
                <tr key={a.id} className="hover:bg-[#25262E]/50 transition-colors">
                  <td className="px-5 py-4">
                    <input type="checkbox" className="rounded bg-[#111217] border-[#3A3B45] accent-blue-500"
                      checked={selectedAgentIds.has(a.id)} onChange={() => toggleSelectAgent(a.id)} />
                  </td>
                  <td className="px-4 py-4 font-medium text-white uppercase">{a.hostname}</td>
                  <td className="px-4 py-4 font-mono text-xs text-gray-400">{a.ip}</td>
                  <td className="px-4 py-4"><MiniBar value={a.cpuPercent} label="CPU" /></td>
                  <td className="px-4 py-4"><MiniBar value={a.memPercent} label="Mem" /></td>
                  <td className="px-4 py-4 text-gray-400">{new Date(a.lastHeartbeat).toLocaleString()}</td>
                  <td className="px-4 py-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${a.status === 'online' ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                      {a.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <div className="relative inline-block" ref={openMenuId === a.id ? menuRef : null}>
                      <button
                        onClick={() => setOpenMenuId(openMenuId === a.id ? null : a.id)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#3A3B45] transition-colors"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {openMenuId === a.id && (
                        <div className="absolute right-0 mt-2 w-56 bg-[#1C1D24] border border-[#3A3B45] rounded-md shadow-2xl z-50 py-1.5 text-sm overflow-hidden origin-top-right">
                          <button
                            onClick={() => { setActiveAgent(a); setView('iptables'); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors"
                          >Config/View Iptables</button>
                          <button
                            onClick={() => { setKeyModalAgent(a); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors flex items-center gap-2"
                          ><Key size={14} className="text-gray-500" /> Manage TLS Key</button>
                          <button className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors">Manage Policies</button>
                          <button
                            onClick={() => { setHealthModalAgent(a); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors"
                          >View Device Info</button>
                          <button className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors">View Associated Users</button>
                          <div className="border-t border-[#3A3B45] my-1"></div>
                          <button className="w-full text-left px-4 py-2.5 text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors">Uninstall Agent</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan="8" className="px-4 py-16 text-center text-gray-500">No devices found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch Rule Modal — full EditRule-style form */}
      {showBatchModal && (
        <BatchRuleModal
          selectedCount={selectedAgentIds.size}
          onSubmit={handleBatchSubmit}
          onCancel={() => setShowBatchModal(false)}
        />
      )}

      {/* Agent Key Modal */}
      {keyModalAgent && (
        <AgentKeyModal agent={keyModalAgent} onClose={() => setKeyModalAgent(null)} />
      )}

      {/* Agent Health Modal */}
      {healthModalAgent && (
        <AgentHealthModal agent={healthModalAgent} onClose={() => setHealthModalAgent(null)} />
      )}

      {/* Batch progress widget — floats bottom-right */}
      {batchJobInfo && (
        <div className="fixed bottom-4 right-4 z-40">
          <BatchProgress
            batchJobId={batchJobInfo.batchJobId}
            total={batchJobInfo.total}
            initialSuccess={batchJobInfo.initialSuccess}
            initialFailed={batchJobInfo.initialFailed}
            onClose={() => setBatchJobInfo(null)}
          />
        </div>
      )}
    </div>
  );
}
