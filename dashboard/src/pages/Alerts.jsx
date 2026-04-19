import React, { useState, useMemo } from 'react';
import { ShieldAlert, AlertTriangle, Info, CheckCircle, Search, Clock, RefreshCw } from 'lucide-react';
import { useAlerts, resolveAlert } from '../hooks/useApi';

export default function Alerts() {
  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState('all');
  const [resolvedFilter, setResolvedFilter] = useState('false');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { data: alerts, loading, error, refetch } = useAlerts(`?limit=500&resolved=${resolvedFilter}`);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const filteredAlerts = useMemo(() => {
    if (!alerts) return [];
    let filtered = alerts;
    
    // Filter by time
    if (timeFilter === 'custom') {
      const start = customStart ? new Date(customStart).getTime() : 0;
      const end = customEnd ? new Date(customEnd).getTime() : Infinity;
      filtered = filtered.filter(a => {
        const t = new Date(a.timestamp).getTime();
        return t >= start && t <= end;
      });
    } else if (timeFilter !== 'all') {
      const now = new Date().getTime();
      const msThreshold = parseInt(timeFilter, 10) * 60 * 1000;
      filtered = filtered.filter(a => (now - new Date(a.timestamp).getTime()) <= msThreshold);
    }
    
    // Filter by search term
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(a => 
        a.ruleName.toLowerCase().includes(lower) ||
        a.description.toLowerCase().includes(lower) ||
        (a.agent?.hostname || '').toLowerCase().includes(lower) ||
        (a.agent?.ip || '').toLowerCase().includes(lower)
      );
    }
    
    return filtered;
  }, [alerts, searchTerm, timeFilter]);

  const handleResolve = async (id) => {
    try {
      await resolveAlert(id);
      refetch();
    } catch (err) {
      alert("Failed to resolve alert: " + err.message);
    }
  };

  const getSeverityStyle = (severity) => {
    switch (severity.toLowerCase()) {
      case 'high':
      case 'critical':
        return 'text-red-400 bg-red-950/40 border-red-900/50';
      case 'medium':
        return 'text-orange-400 bg-orange-950/40 border-orange-900/50';
      case 'low':
        return 'text-yellow-400 bg-yellow-950/40 border-yellow-900/50';
      default:
        return 'text-blue-400 bg-blue-950/40 border-blue-900/50';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity.toLowerCase()) {
      case 'high':
      case 'critical':
        return <ShieldAlert size={16} />;
      case 'medium':
        return <AlertTriangle size={16} />;
      default:
        return <Info size={16} />;
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <ShieldAlert className="text-red-500" /> Security Alerts
          </h1>
          <p className="text-sm text-gray-400 mt-1">Rule Engine generated alerts requiring attention.</p>
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
            placeholder="Search by rule, description, agent IP or hostname..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1C1D24] border border-[#2E2F3A] text-white text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-[#E8912E] transition-colors"
          />
        </div>
        <select
          value={resolvedFilter}
          onChange={(e) => setResolvedFilter(e.target.value)}
          className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-[#E8912E] transition-colors min-w-[160px]"
        >
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
          <option value="all">All Alerts</option>
        </select>
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

      {loading && !alerts ? (
        <div className="text-center text-gray-400 py-10">Loading alerts...</div>
      ) : error ? (
        <div className="text-center text-red-400 py-10">Failed to load alerts: {error}</div>
      ) : (
        <div className="grid gap-4">
          {filteredAlerts && filteredAlerts.length > 0 ? (
            filteredAlerts.map((alert) => (
              <div 
                key={alert.id} 
                className={`bg-[#1C1D24] p-5 rounded-xl border border-[#2E2F3A] flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:bg-[#1F2028] shadow-sm ${alert.resolved ? 'opacity-60' : ''}`}
              >
                <div className="flex gap-4">
                  <div className={`mt-1 h-fit px-2 py-1.5 rounded-md flex items-center gap-1.5 border text-xs font-semibold ${getSeverityStyle(alert.severity)}`}>
                    {getSeverityIcon(alert.severity)}
                    {alert.severity.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-white font-medium text-base mb-1">{alert.ruleName}</h3>
                    <p className="text-gray-400 text-sm max-w-2xl">{alert.description}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs">
                      <div className="flex items-center gap-1.5 text-gray-500">
                        <Clock size={14} className="text-gray-600"/>
                        {new Date(alert.timestamp).toLocaleString()}
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-500">
                        <span className="text-[#00E5FF] font-mono">{alert.agent?.hostname || alert.agentId.substring(0,8)}</span>
                        {alert.agent?.ip && `(${alert.agent.ip})`}
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-gray-600 text-[10px] break-all">
                        ID: {alert.id}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center self-end md:self-auto shrink-0">
                  {alert.resolved ? (
                    <span className="flex items-center gap-1.5 text-green-500 text-sm font-medium bg-green-500/10 px-3 py-1.5 rounded-lg border border-green-500/20">
                      <CheckCircle size={16} /> Resolved
                    </span>
                  ) : (
                    <button 
                      onClick={() => handleResolve(alert.id)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-[#25262E] hover:bg-green-600 border border-[#3A3B45] hover:border-green-500 text-gray-300 hover:text-white rounded-lg transition-colors text-sm font-medium"
                    >
                      <CheckCircle size={16} /> Mark as Resolved
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="bg-[#1C1D24] p-10 rounded-xl border border-[#2E2F3A] text-center text-gray-500 shadow-md">
              No alerts found!
            </div>
          )}
        </div>
      )}
    </div>
  );
}
