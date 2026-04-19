import React, { useState, useMemo } from 'react';
import { Activity, Clock, ShieldAlert, Zap, Globe, HardDrive, Search, RefreshCw } from 'lucide-react';
import { useEvents } from '../hooks/useApi';

const EventIcon = ({ type }) => {
  switch (type) {
    case 'Network': return <Globe className="text-blue-400" size={16} />;
    case 'Security': return <ShieldAlert className="text-red-400" size={16} />;
    case 'System': return <HardDrive className="text-purple-400" size={16} />;
    case 'Agent': return <Zap className="text-yellow-400" size={16} />;
    default: return <Activity className="text-gray-400" size={16} />;
  }
};

export default function Events() {
  const { data: events, loading, error, refetch } = useEvents('?limit=500');
  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    let filtered = events;
    
    // Filter by time
    if (timeFilter === 'custom') {
      const start = customStart ? new Date(customStart).getTime() : 0;
      const end = customEnd ? new Date(customEnd).getTime() : Infinity;
      filtered = filtered.filter(e => {
        const t = new Date(e.timestamp).getTime();
        return t >= start && t <= end;
      });
    } else if (timeFilter !== 'all') {
      const now = new Date().getTime();
      const msThreshold = parseInt(timeFilter, 10) * 60 * 1000;
      filtered = filtered.filter(e => (now - new Date(e.timestamp).getTime()) <= msThreshold);
    }
    
    // Filter by search term
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(e => {
        const dataStr = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        return e.type.toLowerCase().includes(lower) ||
               dataStr.toLowerCase().includes(lower) ||
               (e.agent?.hostname || '').toLowerCase().includes(lower) ||
               (e.agent?.ip || '').toLowerCase().includes(lower);
      });
    }
    
    return filtered;
  }, [events, searchTerm, timeFilter]);

  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <Activity className="text-blue-400" /> Events Log
          </h1>
          <p className="text-sm text-gray-400 mt-1">Raw telemetry & system events coming from agents.</p>
        </div>
        <button 
          onClick={handleRefresh} 
          className="flex items-center gap-2 px-4 py-2 bg-[#25262E] hover:bg-gray-700 text-sm text-white rounded-md border border-[#3A3B45] transition-colors"
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input 
            type="text"
            placeholder="Search by event type, data, agent IP or hostname..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1C1D24] border border-[#2E2F3A] text-white text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-[#E8912E] transition-colors"
          />
        </div>
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-[#E8912E] transition-colors min-w-[160px]"
        >
          <option value="all">All Time</option>
          <option value="15">Last 15 minutes</option>
          <option value="30">Last 30 minutes</option>
          <option value="60">Last 1 hour</option>
          <option value="1440">Last 24 hours</option>
          <option value="custom">Custom Range</option>
        </select>
      </div>
      
      {timeFilter === 'custom' && (
        <div className="flex flex-col md:flex-row gap-4 mb-6 pt-2">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>From:</span>
            <input 
              type="datetime-local" 
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-[#E8912E]"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>To:</span>
            <input 
              type="datetime-local" 
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-[#E8912E]"
            />
          </div>
        </div>
      )}

      {loading && !events ? (
        <div className="text-center text-gray-400 py-10">Loading events...</div>
      ) : error ? (
        <div className="text-center text-red-400 py-10">Failed to load events: {error}</div>
      ) : (
        <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-300">
              <thead className="text-xs text-gray-400 bg-[#25262E] border-b border-[#3A3B45] sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-semibold w-12"></th>
                  <th className="px-4 py-3 font-semibold w-40">Time</th>
                  <th className="px-4 py-3 font-semibold w-32">Type</th>
                  <th className="px-4 py-3 font-semibold w-48">Agent</th>
                  <th className="px-4 py-3 font-semibold">Event Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2E2F3A]">
                {filteredEvents && filteredEvents.length > 0 ? (
                  filteredEvents.map((evt) => (
                    <tr key={evt.id} className="hover:bg-[#25262E]/50 transition-colors group">
                      <td className="px-4 py-3 text-center">
                        <EventIcon type={evt.type} />
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {new Date(evt.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded bg-[#2E2F3B] text-gray-300 text-xs border border-[#3A3B45]">
                          {evt.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[#E8912E]">
                        {evt.agent?.hostname || 'Unknown'} <br/>
                        <span className="text-gray-500">{evt.agent?.ip || evt.agentId.substring(0,8)}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[#00E5FF] break-all">
                        {typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
