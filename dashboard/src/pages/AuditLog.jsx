import React, { useState, useMemo } from 'react';
import { ClipboardList, Search, Download, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useAuditLogs, getAuditLogExportUrl } from '../hooks/useApi';
import { getStoredToken } from '../hooks/useAuth';

const ACTION_LABELS = {
  LOGIN_SUCCESS:       { label: 'Login',          color: 'text-green-400  bg-green-950/40  border-green-900/50'  },
  LOGIN_FAIL:         { label: 'Login Failed',    color: 'text-red-400    bg-red-950/40    border-red-900/50'    },
  LOGIN_2FA_PENDING:  { label: '2FA Pending',     color: 'text-yellow-400 bg-yellow-950/40 border-yellow-900/50' },
  LOGIN_2FA_FAIL:     { label: '2FA Failed',      color: 'text-red-400    bg-red-950/40    border-red-900/50'    },
  COMMAND_SEND:       { label: 'Command',         color: 'text-blue-400   bg-blue-950/40   border-blue-900/50'   },
  COMMAND_BATCH_SEND: { label: 'Batch Command',   color: 'text-purple-400 bg-purple-950/40 border-purple-900/50' },
  AGENT_KEY_ADD:      { label: 'Key Add',         color: 'text-cyan-400   bg-cyan-950/40   border-cyan-900/50'   },
  AGENT_KEY_DELETE:   { label: 'Key Delete',      color: 'text-orange-400 bg-orange-950/40 border-orange-900/50' },
  AGENT_KEY_EXPORT:   { label: 'Key Export',      color: 'text-cyan-400   bg-cyan-950/40   border-cyan-900/50'   },
  ALERT_RESOLVE:      { label: 'Alert Resolved',  color: 'text-green-400  bg-green-950/40  border-green-900/50'  },
  RULES_UPDATE:       { label: 'Rules Update',    color: 'text-yellow-400 bg-yellow-950/40 border-yellow-900/50' },
};

export default function AuditLog() {
  const [search,      setSearch]      = useState('');
  const [actionFilter,setActionFilter]= useState('');
  const [outcomeFilter,setOutcomeFilter]=useState('');
  const [fromDate,    setFromDate]    = useState('');
  const [toDate,      setToDate]      = useState('');
  const [isRefreshing,setIsRefreshing]= useState('');

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (actionFilter) p.set('action', actionFilter);
    if (outcomeFilter) p.set('outcome', outcomeFilter);
    if (fromDate) p.set('from', new Date(fromDate).toISOString());
    if (toDate)   p.set('to',   new Date(toDate).toISOString());
    p.set('limit', '500');
    return p.toString() ? `?${p.toString()}` : '';
  }, [actionFilter, outcomeFilter, fromDate, toDate]);

  const { data, loading, error, refetch } = useAuditLogs(queryParams);

  const logs = useMemo(() => {
    if (!data?.logs) return [];
    if (!search) return data.logs;
    const q = search.toLowerCase();
    return data.logs.filter(l =>
      l.username.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      (l.resource || '').toLowerCase().includes(q) ||
      (l.detail   || '').toLowerCase().includes(q) ||
      (l.ip       || '').toLowerCase().includes(q)
    );
  }, [data, search]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleExport = () => {
    const token = getStoredToken();
    const base = getAuditLogExportUrl();
    const p = new URLSearchParams();
    if (fromDate) p.set('from', new Date(fromDate).toISOString());
    if (toDate)   p.set('to',   new Date(toDate).toISOString());
    const url = p.toString() ? `${base}?${p.toString()}` : base;

    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `audit-${Date.now()}.csv`;
        a.click();
      });
  };

  const getActionMeta = (action) =>
    ACTION_LABELS[action] || { label: action, color: 'text-gray-400 bg-gray-800/40 border-gray-700' };

  return (
    <div className="p-6 max-w-7xl mx-auto w-full">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <ClipboardList className="text-[#FF2E63]" /> Audit Log
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Toàn bộ hành động nhạy cảm — {data?.total ?? '…'} bản ghi
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-[#25262E] hover:bg-gray-700 text-sm text-white rounded-md border border-[#3A3B45] transition-colors"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-[#FF2E63]/10 hover:bg-[#FF2E63]/20 text-sm text-[#FF2E63] rounded-md border border-[#FF2E63]/30 transition-colors"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input
            type="text"
            placeholder="Tìm theo user, action, IP, resource..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1C1D24] border border-[#2E2F3A] text-white text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-[#FF2E63] transition-colors"
          />
        </div>

        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#FF2E63] transition-colors"
        >
          <option value="">All Actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <select
          value={outcomeFilter}
          onChange={e => setOutcomeFilter(e.target.value)}
          className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#FF2E63] transition-colors"
        >
          <option value="">All Outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>

        <input
          type="datetime-local"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#FF2E63] transition-colors"
          title="From"
        />
        <input
          type="datetime-local"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#FF2E63] transition-colors"
          title="To"
        />
      </div>

      {/* Table */}
      {loading && !data ? (
        <div className="text-center text-gray-400 py-10">Loading audit logs...</div>
      ) : error ? (
        <div className="text-center text-red-400 py-10">Failed to load: {error}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#2E2F3A]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1C1D24] text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Timestamp</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Resource</th>
                <th className="px-4 py-3 text-left">Detail</th>
                <th className="px-4 py-3 text-left">IP</th>
                <th className="px-4 py-3 text-left">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-gray-500 py-10">Không có bản ghi nào</td>
                </tr>
              ) : logs.map(log => {
                const meta = getActionMeta(log.action);
                return (
                  <tr key={log.id} className="border-t border-[#2E2F3A] hover:bg-[#1F2028] transition-colors">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap font-mono text-xs">
                      <span className="flex items-center gap-1.5">
                        <Clock size={12} className="text-gray-600" />
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white font-medium">{log.username}</span>
                      <span className="ml-2 text-xs text-gray-600 bg-[#25262E] px-1.5 py-0.5 rounded">{log.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-md border text-xs font-semibold ${meta.color}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{log.resource || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[200px] truncate" title={log.detail || ''}>
                      {log.detail || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{log.ip || '—'}</td>
                    <td className="px-4 py-3">
                      {log.outcome === 'success' ? (
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle size={14} /> success
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle size={14} /> failure
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
