import React, { useState, useEffect, useRef, useMemo } from 'react';
import IptablesControl from '../components/IptablesControl';
import EditRule from '../components/EditRule';
import { useAgents } from '../hooks/useApi';
import { Monitor, Search, MoreVertical, LayoutGrid, Users, ShieldAlert, ArrowLeft, RefreshCw, Trash2, Plus, Settings, X, Layers } from 'lucide-react';

import { sendCommand, sendCommandBatch } from '../hooks/useApi';

export default function Agents() {
  const { data: agents, refetch: refetchAgents } = useAgents();
  const [view, setView] = useState('list'); // 'list' | 'iptables'
  const [activeAgent, setActiveAgent] = useState(null);
  const [filterChain, setFilterChain] = useState('INPUT'); // Đổi thành Tab kiểu pfSense
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [openMenuId, setOpenMenuId] = useState(null);

  // Batch selection
  const [selectedAgentIds, setSelectedAgentIds] = useState(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchRule, setBatchRule] = useState({ action: 'DROP', protocol: 'tcp', chain: 'INPUT', port: '', src: '' });
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  // Sync activeAgent when agents data updates (e.g. after reload)
    useEffect(() => {
      if (activeAgent && agents) {
        const updated = agents.find(a => a.id === activeAgent.id);
        if (updated) {
          setActiveAgent(updated);
        }
      }
    }, [agents, activeAgent?.id]);
  // States for Add Rule Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRule, setNewRule] = useState({ action: 'ACCEPT', protocol: 'tcp', port: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Parse iptables text output into structured data for tables
  const parsedRules = useMemo(() => {
    if (!activeAgent || !activeAgent.iptablesRules) return [];
    const text = activeAgent.iptablesRules;
    const chains = text.split(/(?=Chain \w+)/);
    
    let targetChainStr = chains.find(c => c.startsWith(`Chain ${filterChain}`));
    if (!targetChainStr) return [];

    let lines = targetChainStr.split('\n').map(l => l.trim()).filter(Boolean);
    // Bỏ qua dòng header: "Chain INPUT (policy ACCEPT)" và "num  target  prot  opt  source  destination"
    lines = lines.filter(l => !l.startsWith('Chain') && !l.startsWith('num'));

    return lines.map(line => {
      // vd: 1 DROP all -- 192.168.1.10 0.0.0.0/0
      const parts = line.split(/\s+/);
      if (parts.length < 6) return { raw: line };
      return {
        num: parts[0],
        target: parts[1],
        prot: parts[2],
        opt: parts[3],
        source: parts[4],
        destination: parts[5],
        extra: parts.slice(6).join(' '),
        raw: line
      };
    });
  }, [activeAgent?.iptablesRules, filterChain]);

  // Parse default policy for the current chain (e.g. ACCEPT / DROP)
  const chainPolicy = useMemo(() => {
    if (!activeAgent?.iptablesRules) return null;
    const match = activeAgent.iptablesRules.match(
      new RegExp(`Chain ${filterChain} \\(policy (\\w+)`)
    );
    return match ? match[1] : null;
  }, [activeAgent?.iptablesRules, filterChain]);

  const handleDeleteRule = async (num, protocol, target) => {
    if (!confirm(`Are you sure you want to delete form Rule #${num}?`)) return;
    try {
      await sendCommand(activeAgent.id, 'delete_rule', { chain: filterChain, num: num });
      alert("Delete command queued. Wait a few seconds for the agent to process it, then click Reload.");
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  const handleAddRuleSubmit = async (e) => {
    e.preventDefault();
    if (["tcp", "udp", "tcp/udp"].includes(newRule.protocol) && !newRule.port.trim()) return alert("Please enter a Port for TCP/UDP.");
    if (newRule.disabled) { alert("Rule is disabled, skipped adding to iptables."); return; }
    setIsSubmitting(true);
    try {
      await sendCommand(activeAgent.id, 'add_rule', { 
        chain: filterChain, 
        priority: newRule.priority,
        protocol: newRule.protocol, 
        port: newRule.port, 
        target: newRule.action,
        log: newRule.log || false,
        logPrefix: newRule.logPrefix || `FW_LOG_${newRule.action || 'RULE'}: `,
        states: newRule.states || [],
        srcType: newRule.srcType,
        src: newRule.src,
        srcMask: newRule.srcMask,
        srcInvert: newRule.srcInvert,
        sport: newRule.sport,
        dstType: newRule.dstType,
        dst: newRule.dst,
        dstMask: newRule.dstMask,
        dstInvert: newRule.dstInvert
      });
      alert(`Successfully sent instruction to add rule to ${filterChain}. Wait a few seconds then reload.`);
      setShowAddModal(false);
      setNewRule({ action: 'ACCEPT', protocol: 'tcp', port: '' });
    } catch (err) {
      alert("Failed to add rule: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            {/* <ShieldAlert className="text-[#FF2E63]" /> */}
            Firewall Rules: {activeAgent.hostname}
          </h1>
        </header>

        {/* pfSense Style TABS */}
        <div className="flex items-center gap-6 border-b border-[#2E2F3A] mb-4 overflow-x-auto">
          {availableChains.map(chain => {
            // Parse policy for each chain tab
            const policyMatch = activeAgent?.iptablesRules?.match(
              new RegExp(`Chain ${chain} \\(policy (\\w+)`)
            );
            const policy = policyMatch ? policyMatch[1] : null;
            return (
              <button 
                key={chain}
                onClick={() => setFilterChain(chain)}
                className={`pb-3 px-1 border-b-2 transition-colors font-medium text-sm whitespace-nowrap flex items-center gap-2 ${filterChain === chain ? 'border-[#E8912E] text-[#E8912E]' : 'border-transparent text-gray-400 hover:text-gray-300'}`}
              >
                {chain}
                {policy && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    policy === 'ACCEPT'
                      ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                      : policy === 'DROP'
                      ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                      : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                  }`}>
                    {policy}
                  </span>
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
                       chainPolicy === 'ACCEPT'
                         ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                         : chainPolicy === 'DROP'
                         ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                         : 'bg-gray-500/15 text-gray-300 border border-gray-500/30'
                     }`}>
                       {chainPolicy}
                     </span>
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
            
            {/* PfSense Style Table */}
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
                  {parsedRules.length > 0 ? (
                    parsedRules.map((rule, idx) => (
                      <tr key={idx} className="hover:bg-[#25262E]/70 transition-colors">
                        <td className="px-4 py-3 font-mono text-gray-500">{rule.num}</td>
                        <td className="px-4 py-3 text-yellow-400 font-mono">{rule.prot}</td>
                        <td className="px-4 py-3 text-cyan-400 font-mono">{rule.source}</td>
                        <td className="px-4 py-3 text-cyan-400 font-mono">{rule.destination}</td>
                        <td className="px-4 py-3 text-purple-400 font-mono">{rule.extra || '*'}</td>
                        <td className="px-4 py-3 font-bold">
                          <span className={`px-2 py-1 rounded-sm text-xs ${rule.target === 'ACCEPT' ? 'text-green-500 bg-green-500/10' : rule.target === 'DROP' ? 'text-red-500 bg-red-500/10' : 'text-gray-300'}`}>
                            {rule.target}
                          </span>
                        </td>
                        <td className="px-4 py-3 flex items-center justify-center gap-2">
                           <button 
                             onClick={() => setView('edit-rule')}
                             className="text-gray-500 hover:text-blue-400 p-1" title="Edit"
                           >
                              <Settings size={16} />
                           </button>
                           <button onClick={() => handleDeleteRule(rule.num, rule.prot, rule.target)} className="text-gray-500 hover:text-red-400 p-1" title="Delete">
                              <Trash2 size={16} />
                           </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="px-4 py-16 text-center text-gray-500">
                        Không có rule nào ở Chain này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom Actions PfSense Style */}
            <div className="flex items-center gap-2 justify-end p-4 border-t border-[#3A3B45] bg-[#25262E]">
               <button onClick={() => { setShowAddModal(false); setView('edit-rule'); }} className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded shadow transition-colors">
                  <Plus size={16} /> Add Rule
               </button>
            </div>
        </div>

        {/* Quick Actions Form */}
        <div className="mt-8 opacity-60">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 bg-[#25262E] inline-block px-4 py-1.5 rounded-md border border-[#3A3B45]">
             Quick Policy Add / Block IPs
          </h3>
          <IptablesControl prefilledAgentId={activeAgent.id} />
        </div>

        {/* Add Rule Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
              {/* Header */}
              <div className="bg-[#25262E] border-b border-[#3A3B45] px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Edit Firewall Rule [{filterChain}]</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white transition hidden md:block"><X size={20}/></button>
              </div>

              {/* Form Body - PfSense Style Grid */}
              <form onSubmit={handleAddRuleSubmit} className="p-0 text-sm overflow-y-auto max-h-[80vh]">
                 <div className="grid grid-cols-[160px_1fr] border-b border-[#2E2F3A]">
                    <div className="bg-[#25262E] p-4 text-gray-300 font-medium">Action</div>
                    <div className="p-4 bg-[#111217]">
                       <select 
                         value={newRule.action} 
                         onChange={e => setNewRule({...newRule, action: e.target.value})}
                         className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full max-w-sm focus:outline-none focus:border-blue-500"
                       >
                         <option value="ACCEPT">Pass (ACCEPT)</option>
                         <option value="DROP">Block (DROP)</option>
                         <option value="REJECT">Reject (REJECT)</option>
                         <option value="LOG">Log (LOG)</option>
                       </select>
                       <p className="text-gray-500 text-xs mt-2">Choose what to do with packets that match the criteria specified below.</p>
                    </div>
                 </div>

                 <div className="grid grid-cols-[160px_1fr] border-b border-[#2E2F3A]">
                    <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">Protocol</div>
                    <div className="p-4 bg-[#111217]">
                       <select 
                         value={newRule.protocol} 
                         onChange={e => setNewRule({...newRule, protocol: e.target.value})}
                         className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full max-w-sm focus:outline-none focus:border-blue-500"
                       >
                         <option value="tcp">TCP</option>
                         <option value="udp">UDP</option>
                         <option value="icmp">ICMP</option>
                         <option value="all">Any (All)</option>
                         <option value="icmpv6">ICMPv6</option>
                         <option value="sctp">SCTP</option>
                         <option value="udplite">UDPLite</option>
                         <option value="esp">ESP</option>
                         <option value="ah">AH</option>
                         <option value="mh">MH</option>
                         <option value="47">GRE (47)</option>
                       </select>
                       <p className="text-gray-500 text-xs mt-2">Choose which IP protocol this rule should match.</p>
                    </div>
                 </div>

                 <div className="grid grid-cols-[160px_1fr] border-b border-[#2E2F3A]">
                    <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">Destination Port</div>
                    <div className="p-4 bg-[#111217]">
                       <input 
                         type="text" 
                         placeholder="e.g. 80, 443"
                         value={newRule.port}
                         onChange={e => setNewRule({...newRule, port: e.target.value})}
                         className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full max-w-sm focus:outline-none focus:border-blue-500 font-mono placeholder:font-sans"
                         required
                       />
                       <p className="text-gray-500 text-xs mt-2">Specify the port or port range for the destination of the packet.</p>
                    </div>
                 </div>

                 <div className="grid grid-cols-[160px_1fr]">
                    <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">Description</div>
                    <div className="p-4 bg-[#111217]">
                       <input 
                         type="text" 
                         placeholder="Optional description"
                         className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full max-w-sm focus:outline-none focus:border-blue-500"
                       />
                       <p className="text-gray-500 text-xs mt-2">You may enter a description here for your reference (not applied tightly on direct iptables API right now).</p>
                    </div>
                 </div>

                 {/* Footer Actions */}
                 <div className="bg-[#25262E] p-4 flex gap-3 justify-end border-t border-[#3A3B45]">
                    <button 
                      type="button" 
                      onClick={() => setShowAddModal(false)}
                      className="px-5 py-2 text-gray-300 hover:text-white hover:bg-gray-700/50 rounded transition font-medium"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded shadow disabled:opacity-50 transition font-medium flex items-center gap-2"
                    >
                      {isSubmitting ? 'Saving...' : 'Save'}
                    </button>
                 </div>
              </form>
            </div>
          </div>
        )}
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

  // Filter Logic
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

  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    if (['tcp', 'udp'].includes(batchRule.protocol) && !batchRule.port.trim())
      return alert('Port is required for TCP/UDP rules.');
    setBatchSubmitting(true);
    try {
      const result = await sendCommandBatch(Array.from(selectedAgentIds), 'add_rule', {
        chain: batchRule.chain, protocol: batchRule.protocol, port: batchRule.port,
        target: batchRule.action, src: batchRule.src || undefined,
        srcType: batchRule.src ? 'single' : 'any',
      });
      alert(`Dispatched to ${result.dispatched} agent(s).${result.errors?.length ? ` ${result.errors.length} failed.` : ''}`);
      setShowBatchModal(false);
      setBatchRule({ action: 'DROP', protocol: 'tcp', chain: 'INPUT', port: '', src: '' });
      setSelectedAgentIds(new Set());
    } catch (err) {
      alert('Batch dispatch failed: ' + err.message);
    } finally {
      setBatchSubmitting(false);
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
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111217] border border-[#3A3B45] text-gray-200 text-sm rounded-md pl-10 pr-4 py-2 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
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

        {/* Batch Actions Bar */}
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
                <th className="px-5 py-4 w-12"><input type="checkbox" className="rounded bg-[#111217] border-[#3A3B45] accent-blue-500" checked={filteredAgents.length > 0 && selectedAgentIds.size === filteredAgents.length} onChange={toggleSelectAll} /></th>
                <th className="px-4 py-4 font-medium">Device Names</th>
                <th className="px-4 py-4 font-medium">Users</th>
                <th className="px-4 py-4 font-medium">OS Type</th>
                <th className="px-4 py-4 font-medium">Agent Version</th>
                <th className="px-4 py-4 font-medium">Last Seen</th>
                <th className="px-4 py-4 font-medium">Status</th>
                <th className="px-4 py-4 font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2E2F3A]">
              {filteredAgents.length ? filteredAgents.map(a => (
                <tr key={a.id} className="hover:bg-[#25262E]/50 transition-colors">
                  <td className="px-5 py-4"><input type="checkbox" className="rounded bg-[#111217] border-[#3A3B45] accent-blue-500" checked={selectedAgentIds.has(a.id)} onChange={() => toggleSelectAgent(a.id)} /></td>
                  <td className="px-4 py-4 font-medium text-white uppercase">{a.hostname}</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1.5 text-blue-400">
                      <Users size={14} /> 1
                    </div>
                  </td>
                  <td className="px-4 py-4">{a.os || 'Linux'}</td>
                  <td className="px-4 py-4 text-gray-400">1.0.0</td>
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
                      
                      {/* Dropdown Menu */}
                      {openMenuId === a.id && (
                        <div className="absolute right-0 mt-2 w-56 bg-[#1C1D24] border border-[#3A3B45] rounded-md shadow-2xl z-50 py-1.5 text-sm overflow-hidden origin-top-right">
                          <button 
                            onClick={() => { setActiveAgent(a); setView('iptables'); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors"
                          >
                            Config/View Iptables
                          </button>
                          <button className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors">
                            Manage Policies
                          </button>
                          <button className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors">
                            View Device Info
                          </button>
                          <button className="w-full text-left px-4 py-2.5 text-gray-300 hover:bg-[#25262E] hover:text-white transition-colors">
                            View Associated Users
                          </button>
                          <div className="border-t border-[#3A3B45] my-1"></div>
                          <button className="w-full text-left px-4 py-2.5 text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors">
                            Uninstall Agent
                          </button>
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
      {/* Batch Rule Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="bg-[#25262E] border-b border-[#3A3B45] px-6 py-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Layers size={16} className="text-blue-400" />
                Push Iptables Rule — {selectedAgentIds.size} Devices
              </h2>
              <button onClick={() => setShowBatchModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleBatchSubmit} className="text-sm">
              <div className="grid grid-cols-[140px_1fr] border-b border-[#2E2F3A]">
                <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">Chain</div>
                <div className="p-4 bg-[#111217]">
                  <select value={batchRule.chain} onChange={e => setBatchRule({...batchRule, chain: e.target.value})}
                    className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full focus:outline-none focus:border-blue-500">
                    <option value="INPUT">INPUT</option>
                    <option value="FORWARD">FORWARD</option>
                    <option value="OUTPUT">OUTPUT</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-[140px_1fr] border-b border-[#2E2F3A]">
                <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">Action</div>
                <div className="p-4 bg-[#111217]">
                  <select value={batchRule.action} onChange={e => setBatchRule({...batchRule, action: e.target.value})}
                    className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full focus:outline-none focus:border-blue-500">
                    <option value="ACCEPT">ACCEPT</option>
                    <option value="DROP">DROP</option>
                    <option value="REJECT">REJECT</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-[140px_1fr] border-b border-[#2E2F3A]">
                <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">Protocol</div>
                <div className="p-4 bg-[#111217]">
                  <select value={batchRule.protocol} onChange={e => setBatchRule({...batchRule, protocol: e.target.value})}
                    className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full focus:outline-none focus:border-blue-500">
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="icmp">ICMP</option>
                    <option value="all">Any</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-[140px_1fr] border-b border-[#2E2F3A]">
                <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">Destination Port</div>
                <div className="p-4 bg-[#111217]">
                  <input type="text" placeholder="e.g. 80, 443"
                    value={batchRule.port} onChange={e => setBatchRule({...batchRule, port: e.target.value})}
                    disabled={batchRule.protocol === 'icmp' || batchRule.protocol === 'all'}
                    className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50" />
                </div>
              </div>
              <div className="grid grid-cols-[140px_1fr] border-b border-[#2E2F3A]">
                <div className="bg-[#25262E] p-4 text-gray-300 font-medium flex items-center">
                  Source IP <span className="ml-1 text-gray-500 font-normal">(opt)</span>
                </div>
                <div className="p-4 bg-[#111217]">
                  <input type="text" placeholder="e.g. 10.0.0.0/8 — leave blank for any"
                    value={batchRule.src} onChange={e => setBatchRule({...batchRule, src: e.target.value})}
                    className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-2 w-full font-mono focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="bg-[#25262E] p-4 flex gap-3 justify-end border-t border-[#3A3B45]">
                <button type="button" onClick={() => setShowBatchModal(false)}
                  className="px-5 py-2 text-gray-300 hover:text-white hover:bg-gray-700/50 rounded transition font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={batchSubmitting}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 transition font-medium flex items-center gap-2">
                  {batchSubmitting ? 'Dispatching...' : `Dispatch to ${selectedAgentIds.size} Devices`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
