import React from 'react';
import { Settings } from 'lucide-react';

export default function EditRule({ agent, filterChain, newRule, setNewRule, isSubmitting, onSubmit, onCancel }) {
  const [showAdvancedSource, setShowAdvancedSource] = React.useState(false);
  // Parse interfaces if we added them to DB/agent sync
  const agentInterfaces = agent?.interfaces ? (typeof agent.interfaces === 'string' ? JSON.parse(agent.interfaces) : agent.interfaces) : [];
  
  return (
    <div className="p-6 pb-20 max-w-[1400px] mx-auto text-gray-200 space-y-6 opacity-95">
      <header className="mb-6 flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm text-[#00E5FF] font-medium bg-[#1C1D24]/80 p-3 rounded border border-[#2E2F3A]">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 cursor-pointer hover:text-white transition-colors">Agent</span>
            <span className="text-gray-500">/</span>
            <span className="text-[#00E5FF] cursor-pointer hover:text-white transition-colors" onClick={onCancel}>Rules</span>
            <span className="text-gray-500">/</span>
            <span>Edit</span>
          </div>
        </div>
      </header>

      <form onSubmit={onSubmit} className="bg-[#1C1D24]/90 backdrop-blur-sm border border-[#2E2F3A] rounded-md shadow-2xl overflow-hidden text-sm">
        
        {/* Header 1 */}
        <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white">
          Edit Firewall Rule ({filterChain})
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Rule Order (Priority)</div>
          <div className="p-4 bg-[#21222C]/70">
            <input 
              type="number" 
              value={newRule.priority || ''}
              onChange={e => setNewRule({...newRule, priority: e.target.value})}
              placeholder="e.g. 1 (Lowest number = Highest priority)"
              className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]"
            />
            <p className="text-gray-500 text-xs mt-1">
              Specifies the rule order (1 is highest priority). Leave blank to append at the end.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Action</div>
          <div className="p-4 bg-[#21222C]/70">
            <select 
              value={newRule.action} 
              onChange={e => setNewRule({...newRule, action: e.target.value})}
              className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]"
            >
              <option value="ACCEPT">ACCEPT</option>
              <option value="DROP">DROP</option>
              <option value="REJECT">REJECT</option>
            </select>
            <p className="text-gray-500 text-xs mt-1 max-w-3xl">
              Choose what to do with packets that match the criteria specified below.<br/>
              Hint: the difference between block and reject is that with reject, a packet (TCP RST or ICMP port unreachable for UDP) is returned to the sender, whereas with block the packet is dropped silently. In either case, the original packet is discarded.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Disabled</div>
          <div className="p-4 bg-[#21222C]/70">
             <label className="flex items-center gap-2 cursor-pointer">
               <input 
                 type="checkbox" 
                 checked={newRule.disabled || false}
                 onChange={e => setNewRule({...newRule, disabled: e.target.checked})}
                 className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
               />
               <span className="text-gray-300">Disable this rule</span>
             </label>
             <p className="text-gray-500 text-xs mt-1">Set this option to disable this rule without removing it from the list.</p>
          </div>
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Interface</div>
          <div className="p-4 bg-[#21222C]/70">
            <select 
              value={newRule.interface || 'any'}
              onChange={e => setNewRule({...newRule, interface: e.target.value})}
              className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]"
            >
                <option value="any">Any</option>
                {agentInterfaces?.length > 0 && agentInterfaces.map(iface => (
                  <option key={iface} value={iface}>{iface}</option>
                ))}
            </select>
            <p className="text-gray-500 text-xs mt-1">Choose the interface from which packets must come to match this rule.</p>
          </div>
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Address Family</div>
          <div className="p-4 bg-[#21222C]/70">
            <select 
              value={newRule.addressFamily || 'ipv4'}
              onChange={e => setNewRule({...newRule, addressFamily: e.target.value})}
              className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]"
            >
                  <option value="ipv4">IPv4</option>
                  <option value="ipv6">IPv6</option>
              </select>
              <p className="text-gray-500 text-xs mt-1">Select the Internet Protocol version this rule applies to.</p>
            </div>
          </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Protocol</div>
          <div className="p-4 bg-[#21222C]/70">
            <select 
              value={newRule.protocol} 
              onChange={e => setNewRule({...newRule, protocol: e.target.value})}
              className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-full max-w-md focus:outline-none focus:border-[#E8912E]"
            >
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
            <p className="text-gray-500 text-xs mt-1">Choose which IP protocol this rule should match.</p>
          </div>
        </div>

        {/* Header 2 */}
        <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white mt-4 border-t">
          Source
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white">Source</div>
          <div className="p-4 bg-[#21222C]/70">
             <div className="flex gap-4 items-center">
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={newRule.srcInvert || false}
                   onChange={e => setNewRule({...newRule, srcInvert: e.target.checked})}
                   className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
                 />
                 <span className="text-gray-300">Invert match</span>
               </label>
               <select 
                 value={newRule.srcType || 'any'}
                 onChange={e => setNewRule({...newRule, srcType: e.target.value})}
                 className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none"
               >
                  <option value="any">any</option>
                  <option value="single">Single host or alias</option>
                  <option value="network">Network</option>
               </select>
               <input 
                 type="text" 
                 value={newRule.src || ''}
                 onChange={e => setNewRule({...newRule, src: e.target.value})}
                 disabled={newRule.srcType === 'any'}
                 placeholder="Source Address" 
                 className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 flex-1 focus:outline-none ${newRule.srcType === 'any' ? 'opacity-50 cursor-not-allowed' : ''}`}
               />
               <input 
                 type="text" 
                 value={newRule.srcMask || ''}
                 onChange={e => setNewRule({...newRule, srcMask: e.target.value})}
                 disabled={newRule.srcType === 'any' || newRule.srcType === 'single'}
                 placeholder="/" 
                 className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-16 focus:outline-none ${newRule.srcType === 'any' || newRule.srcType === 'single' ? 'opacity-50 cursor-not-allowed' : ''}`}
               />
             </div>
             
             {!showAdvancedSource && (
               <button 
                 type="button" 
                 onClick={() => setShowAdvancedSource(true)}
                 className="mt-4 bg-blue-600/80 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5 backdrop-blur-sm"
               >
                 <Settings size={14}/> Display Advanced
               </button>
             )}
             <p className="text-gray-500 text-xs mt-2 max-w-3xl">Specify the source IP address or network for this rule. Choose <strong>any</strong> to match all sources.</p>
             <p className="text-gray-500 text-xs mt-2 max-w-3xl">The <strong>Source Port Range</strong> for a connection is typically random and almost never equal to the destination port. In most cases this setting must remain at its default value, <strong>any</strong>.</p>
          </div>
        </div>

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
                 <input
                   type="text"
                   value={newRule.sport || ''}
                   onChange={e => setNewRule({...newRule, sport: e.target.value})}
                   disabled={!['tcp', 'udp', 'tcp/udp'].includes(newRule.protocol)}
                   placeholder={['tcp', 'udp', 'tcp/udp'].includes(newRule.protocol) ? "" : "N/A for " + (newRule.protocol || 'this protocol')}
                   className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none focus:border-[#E8912E] font-mono ${!['tcp', 'udp', 'tcp/udp'].includes(newRule.protocol) ? 'opacity-50 cursor-not-allowed' : ''}`}
                 />
                 <div className="min-w-10"></div>
                 <input 
                   type="text" 
                   disabled
                   placeholder="" 
                   className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none font-mono opacity-50 cursor-not-allowed"
                 />
               </div>
               <p className="text-gray-500 text-xs mt-2">Specify the source port or port range for the packet.</p>
            </div>
          </div>
        )}

        {/* Header 3 */}
        <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white mt-4 border-t">
          Destination
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white">Destination</div>
          <div className="p-4 bg-[#21222C]/70">
             <div className="flex gap-4 items-center">
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={newRule.dstInvert || false}
                   onChange={e => setNewRule({...newRule, dstInvert: e.target.checked})}
                   className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
                 />
                 <span className="text-gray-300">Invert match</span>
               </label>
               <select 
                 value={newRule.dstType || 'any'}
                 onChange={e => setNewRule({...newRule, dstType: e.target.value})}
                 className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none"
               >
                  <option value="any">any</option>
                  <option value="single">Single host or alias</option>
                  <option value="network">Network</option>
               </select>
               <input 
                 type="text" 
                 value={newRule.dst || ''}
                 onChange={e => setNewRule({...newRule, dst: e.target.value})}
                 disabled={newRule.dstType === 'any'}
                 placeholder="Destination Address" 
                 className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 flex-1 focus:outline-none ${newRule.dstType === 'any' ? 'opacity-50 cursor-not-allowed' : ''}`}
               />
               <input 
                 type="text" 
                 value={newRule.dstMask || ''}
                 onChange={e => setNewRule({...newRule, dstMask: e.target.value})}
                 disabled={newRule.dstType === 'any' || newRule.dstType === 'single'}
                 placeholder="/" 
                 className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-16 focus:outline-none ${newRule.dstType === 'any' || newRule.dstType === 'single' ? 'opacity-50 cursor-not-allowed' : ''}`}
               />
             </div>
             <p className="text-gray-500 text-xs mt-2 max-w-3xl">Specify the destination IP address or network for this rule. Choose <strong>any</strong> to match all destinations.</p>
          </div>
        </div>

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
               <input
                 type="text"
                 value={newRule.port || ''}
                 onChange={e => setNewRule({...newRule, port: e.target.value})}
                 disabled={!['tcp', 'udp', 'tcp/udp'].includes(newRule.protocol)}
                 placeholder={['tcp', 'udp', 'tcp/udp'].includes(newRule.protocol) ? "" : "N/A for " + (newRule.protocol || 'this protocol')}
                 className={`bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none focus:border-[#E8912E] font-mono ${!['tcp', 'udp', 'tcp/udp'].includes(newRule.protocol) ? 'opacity-50 cursor-not-allowed' : ''}`}
               />
               <div className="min-w-10"></div>
               <input 
                 type="text" 
                 disabled
                 placeholder="" 
                 className="bg-[#1C1D24] border border-[#3A3B45] text-white rounded px-3 py-1.5 w-48 focus:outline-none font-mono opacity-50 cursor-not-allowed"
               />
             </div>
             
             <p className="text-gray-500 text-xs mt-2">Specify the port or port range for the destination of the packet. The "To" field may be left empty if only filtering a single port.</p>
          </div>
        </div>

        {/* Extra Options Header */}
        <div className="bg-[#25262E]/90 px-4 py-2 border-b border-[#3A3B45] font-semibold text-white mt-4 border-t">
          Extra Options
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">State</div>
          <div className="p-4 bg-[#21222C]/70">
             <div className="flex gap-6 items-center">
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={newRule.states?.includes('NEW') || false}
                   onChange={e => {
                     const st = new Set(newRule.states || []);
                     if (e.target.checked) st.add('NEW'); else st.delete('NEW');
                     setNewRule({...newRule, states: Array.from(st)});
                   }}
                   className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
                 />
                 <span className="text-gray-300 text-sm">NEW</span>
               </label>
               
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={newRule.states?.includes('ESTABLISHED') || false}
                   onChange={e => {
                     const st = new Set(newRule.states || []);
                     if (e.target.checked) st.add('ESTABLISHED'); else st.delete('ESTABLISHED');
                     setNewRule({...newRule, states: Array.from(st)});
                   }}
                   className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
                 />
                 <span className="text-gray-300 text-sm">ESTABLISHED</span>
               </label>
               
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={newRule.states?.includes('RELATED') || false}
                   onChange={e => {
                     const st = new Set(newRule.states || []);
                     if (e.target.checked) st.add('RELATED'); else st.delete('RELATED');
                     setNewRule({...newRule, states: Array.from(st)});
                   }}
                   className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
                 />
                 <span className="text-gray-300 text-sm">RELATED</span>
               </label>
               
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={newRule.states?.includes('INVALID') || false}
                   onChange={e => {
                     const st = new Set(newRule.states || []);
                     if (e.target.checked) st.add('INVALID'); else st.delete('INVALID');
                     setNewRule({...newRule, states: Array.from(st)});
                   }}
                   className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
                 />
                 <span className="text-gray-300 text-sm">INVALID</span>
               </label>
             </div>
             <p className="text-gray-500 text-xs mt-2 max-w-4xl">
               Matches a connection state. By default, matches any state. 
               pfSense allows filtering by specific TCP/IP protocol states (e.g. tracking established connections).
             </p>
          </div>
        </div>

        <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
          <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">Log</div>
          <div className="p-4 bg-[#21222C]/70">
             <label className="flex items-center gap-2 cursor-pointer">
               <input 
                 type="checkbox" 
                 checked={newRule.log || false}
                 onChange={e => setNewRule({...newRule, log: e.target.checked})}
                 className="rounded bg-[#1C1D24] border-[#3A3B45] accent-blue-500" 
               />
               <span className="text-gray-300">Log packets that are handled by this rule</span>
             </label>
               
               {newRule.log && (
                 <div className="mt-3 flex items-center gap-3">
                   <span className="text-gray-400 text-sm whitespace-nowrap">Log Prefix:</span>
                   <input 
                     type="text" 
                     value={newRule.logPrefix || ''}
                     onChange={e => setNewRule({...newRule, logPrefix: e.target.value})}
                     placeholder={`FW_LOG_${newRule.action || 'RULE'}:`}
                     maxLength={29}
                     className="bg-[#1C1D24] border border-[#3A3B45] text-white text-sm rounded px-3 py-1.5 w-64 focus:outline-none focus:border-[#E8912E] font-mono text-xs"
                   />
                 </div>
               )}

               <p className="text-gray-500 text-xs mt-3 max-w-4xl">
               Hint: the firewall has limited local log space. Don't turn on logging for everything. If doing a lot of logging, consider using a remote syslog server 
               (see the <span className="text-[#00E5FF] cursor-pointer hover:underline">Status: System Logs: Settings</span> page).
             </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-[#25262E]/80 p-4 flex gap-3 justify-center border-t border-[#3A3B45] mt-4 backdrop-blur-sm">
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded shadow disabled:opacity-50 transition font-medium flex items-center gap-2 text-sm"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
          <button 
            type="button" 
            onClick={onCancel}
            className="px-6 py-2 bg-gray-600/80 hover:bg-gray-500 text-white rounded shadow transition font-medium text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}