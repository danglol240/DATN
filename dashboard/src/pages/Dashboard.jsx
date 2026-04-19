import React, { useState, useMemo } from 'react';
import { useStats, useAlerts, useAgents, useEvents } from '../hooks/useApi';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, CartesianGrid, Legend } from 'recharts';
import { Monitor, CheckCircle, XCircle, ShieldCheck, Users, ShieldAlert, Activity, ArrowUpCircle, Shield, AlertTriangle, AlertCircle, Zap } from 'lucide-react';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

const MetricCard = ({ title, value, subtext, icon, trend = "up" }) => (
  <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-xl p-4 shadow-sm hover:border-[#3A3B45] transition-all flex flex-col justify-between">
    <div className="flex items-start justify-between">
      <div>
        <h3 className="text-gray-400 text-sm font-medium mb-1">{title}</h3>
        <span className="text-3xl font-bold text-gray-100">{value}</span>
      </div>
      <div className={`p-2 rounded-lg ${
        trend === 'up' ? 'bg-blue-500/10 text-blue-400' :
        trend === 'danger' ? 'bg-red-500/10 text-red-400' :
        trend === 'warning' ? 'bg-amber-500/10 text-amber-500' :
        trend === 'neutral' ? 'bg-gray-500/10 text-gray-400' :
        'bg-green-500/10 text-green-400'
      }`}>
        {icon}
      </div>
    </div>
    {subtext && <p className="text-xs mt-2 text-gray-500">{subtext}</p>}
  </div>
);

const AlertItem = ({ alert }) => (
  <div className="flex items-start gap-4 p-3 border-b border-[#2E2F3A] last:border-0 hover:bg-[#25262E] transition-colors rounded-lg">
    <div className={`mt-1 p-1.5 rounded-full ${alert.severity === 'high' || alert.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-500'}`}>
      <AlertCircle size={14} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-0.5">
        <h4 className="text-sm font-medium text-gray-200 truncate">{alert.ruleName}</h4>
        <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
          {new Date(alert.timestamp || alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p className="text-xs text-gray-400 truncate">{alert.description || 'No detailed description'}</p>
    </div>
  </div>
);

export default function Dashboard() {
  const { data: stats } = useStats();
  const { data: alertsRaw } = useAlerts('?limit=100&resolved=all');
  const { data: agentsRaw } = useAgents();
  const { data: eventsRaw } = useEvents('?limit=100');

  const alerts = alertsRaw || [];
  const agents = agentsRaw || [];
  const events = eventsRaw || [];
  
  // State for time filter
  const [timeFilter, setTimeFilter] = useState('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });

  // State for hiding chart series
  const [hiddenSeries, setHiddenSeries] = useState({ events: false, alerts: false, resolved: false });
  const handleLegendClick = (e) => {
    setHiddenSeries(prev => ({ ...prev, [e.dataKey]: !prev[e.dataKey] }));
  };

  // KPI Metrics calculations
  const totalAgents = stats?.agents ?? agents.length;
  const activeAgents = agents.filter(a => a.status === 'online').length;
  const offlineAgents = totalAgents - activeAgents;
  
  const totalAlerts = stats?.alerts ?? alerts.length;
  const totalEvents = stats?.events ?? events.length;

  const criticalAlerts = alerts.filter(a => a.severity === 'high' || a.severity === 'critical').length;
  const blockActions = alerts.filter(a => a.ruleName?.toLowerCase().includes('block') || a.description?.toLowerCase().includes('block')).length;

  // Policy / Rule coverage
  const agentsWithRules = agents.filter(a => {
    try {
      return Object.keys(JSON.parse(a.rulesConfig || "{}")).length > 0;
    } catch { return false; }
  }).length;
  const rulesPct = totalAgents > 0 ? ((agentsWithRules / totalAgents) * 100).toFixed(1) : 0;

  // Health Score
  const score = totalAgents === 0 ? 100 : Math.max(0, 100 - (criticalAlerts * 5) - (totalAlerts * 1));

  // Activity Line Chart
  const dataActivity = useMemo(() => {
    if (!alerts.length && !events.length) return [];
    const grouped = {};
    const now = Date.now();
    let cutoff = 0;
    let endTime = Infinity;

    if (timeFilter === 'custom') {
      if (customRange.start) cutoff = new Date(customRange.start).getTime();
      if (customRange.end) endTime = new Date(customRange.end).getTime();
    } else if (timeFilter !== 'all') {
      cutoff = now - parseInt(timeFilter) * 60 * 1000;
    }

    [...alerts, ...events].forEach(item => {
      const ts = new Date(item.timestamp || item.createdAt).getTime();
      if ((cutoff > 0 && ts < cutoff) || ts > endTime) return;

      const dateObj = new Date(ts);
      let d = '';
      if (timeFilter === '15' || timeFilter === '30' || timeFilter === '60') {
        d = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      } else {
        d = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }

      if (!grouped[d]) grouped[d] = { name: d, timestamp: ts, alerts: 0, events: 0, resolved: 0 };
      if (item.severity) {
        grouped[d].alerts++;
        if (item.resolved) grouped[d].resolved++;
      }
      else grouped[d].events++;
    });
    
    let sorted = Object.values(grouped).sort((a, b) => a.timestamp - b.timestamp);
    if (timeFilter === 'all') sorted = sorted.slice(-7); // Keep original behavior for "all"
    return sorted;
  }, [alerts, events, timeFilter, customRange]);

  // OS Pie Chart
  const dataHosts = useMemo(() => {
    if (!agents.length) return [];
    return Object.entries(agents.reduce((acc, a) => {
      acc[a.os || 'Linux'] = (acc[a.os || 'Linux'] || 0) + 1;
      return acc;
    }, {})).map(([name, value]) => ({ name, value }));
  }, [agents]);

  // Top Devices by Detection
  const alertCountByAgent = alerts.reduce((acc, a) => {
    if (a.agentId) acc[a.agentId] = (acc[a.agentId] || 0) + 1;
    return acc;
  }, {});
  
  const topDevices = Object.entries(alertCountByAgent)
    .map(([id, count]) => {
      const agent = agents.find(ag => ag.id === id);
      return { name: agent?.hostname || 'Unknown Device', count, id };
    }).sort((a, b) => b.count - a.count).slice(0, 3);

  return (
    <div className="p-6 pb-20 max-w-[1400px] mx-auto text-gray-200 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Dashboard Overview</h1>
      </header>

      {/* Row 1: The Mega KPIs (Combining Old & New) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Agents" value={totalAgents} subtext={`${activeAgents} Online / ${offlineAgents} Offline`} icon={<Monitor size={20} />} trend="up" />
        <MetricCard title="System Alerts" value={totalAlerts} subtext={`${criticalAlerts} Critical Priority`} icon={<AlertTriangle size={20} />} trend="danger" />
        <MetricCard title="Agent Score / Health" value={`${score}%`} subtext={score > 80 ? "Healthy fleet" : "Needs attention"} icon={<Shield size={20} />} trend={score > 80 ? 'success' : 'warning'} />
        <MetricCard title="Rules / Policy Coverage" value={`${rulesPct}%`} subtext={`${agentsWithRules} devices customized`} icon={<ShieldCheck size={20} />} trend="up" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="Total Events Collected" value={totalEvents} icon={<Activity size={20} />} trend="neutral" className="md:col-span-1" />
        <MetricCard title="Blocked Actions" value={blockActions} icon={<XCircle size={20} />} trend="danger" className="md:col-span-1" />
        {/* Placeholder for future specific metric */}
        <div className="bg-[#1C1D24] p-4 rounded-xl border border-[#2E2F3A] flex items-center justify-center opacity-50 md:col-span-2">
            <span className="text-sm text-gray-500">More details coming soon</span>
        </div>
      </div>

      {/* Row 2: Charts (Old Line + New OS/Top Devices) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Alerts Activity Line Chart (From Old) */}
        <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] shadow-md p-5 min-h-[300px] lg:col-span-2 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-red-500 opacity-50"></div>
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-300 flex items-center gap-2">
                 <Activity size={18} className="text-blue-500" /> Alerts & Events Activity
              </h2>
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="all">All Time</option>
                <option value="15">Last 15 mins</option>
                <option value="30">Last 30 mins</option>
                <option value="60">Last 1 hour</option>
                <option value="1440">Last 24 hours</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {timeFilter === 'custom' && (
              <div className="flex items-center justify-end gap-3 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <span>From:</span>
                  <input 
                    type="datetime-local" 
                    value={customRange.start}
                    onChange={(e) => setCustomRange(prev => ({...prev, start: e.target.value}))}
                    className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span>To:</span>
                  <input 
                    type="datetime-local" 
                    value={customRange.end}
                    onChange={(e) => setCustomRange(prev => ({...prev, end: e.target.value}))}
                    className="bg-[#1C1D24] border border-[#2E2F3A] text-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>
          {dataActivity.length > 0 ? (
            <div className="flex-1 w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dataActivity} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorAlerts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorResolved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2E2F3A" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#6B7280" 
                    tick={{fill: '#8B92A5', fontSize: 11}} 
                    axisLine={false} 
                    tickLine={false} 
                    dy={10}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(17, 18, 23, 0.9)', 
                      borderColor: '#3A3B45', 
                      borderRadius: '4px', 
                      color: '#E5E7EB',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
                    }} 
                    itemStyle={{ fontSize: '13px', fontWeight: 500 }}
                    cursor={{ stroke: '#4B5563', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Legend 
                    verticalAlign="bottom" 
                    height={20} 
                    iconType="circle" 
                    wrapperStyle={{ fontSize: '12px', color: '#9CA3AF', paddingTop: '10px', cursor: 'pointer' }} 
                    onClick={handleLegendClick}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="events" 
                    name="Events (Network/Sys)" 
                    stroke={hiddenSeries.events ? '#2E2F3A' : '#3B82F6'} 
                    strokeWidth={2.5} 
                    fillOpacity={hiddenSeries.events ? 0 : 1} 
                    fill="url(#colorEvents)" 
                    activeDot={hiddenSeries.events ? false : { r: 5, strokeWidth: 0, fill: '#60A5FA', style: { filter: 'drop-shadow(0 0 5px #60A5FA)' } }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="alerts" 
                    name="Severity Alerts" 
                    stroke={hiddenSeries.alerts ? '#2E2F3A' : '#EF4444'} 
                    strokeWidth={2.5} 
                    fillOpacity={hiddenSeries.alerts ? 0 : 1} 
                    fill="url(#colorAlerts)" 
                    activeDot={hiddenSeries.alerts ? false : { r: 5, strokeWidth: 0, fill: '#F87171', style: { filter: 'drop-shadow(0 0 5px #F87171)' } }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="resolved" 
                    name="Resolved Alerts" 
                    stroke={hiddenSeries.resolved ? '#2E2F3A' : '#10B981'} 
                    strokeWidth={2.5} 
                    fillOpacity={hiddenSeries.resolved ? 0 : 1} 
                    fill="url(#colorResolved)" 
                    activeDot={hiddenSeries.resolved ? false : { r: 5, strokeWidth: 0, fill: '#34D399', style: { filter: 'drop-shadow(0 0 5px #34D399)' } }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
              <Activity size={40} className="mb-2 opacity-20" />
              <p>No activity recorded yet</p>
            </div>
          )}
        </div>

        {/* OS Distribution (From New) */}
        <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] shadow-md p-5 min-h-[300px] flex flex-col">
          <h2 className="text-base font-semibold text-gray-300 mb-4 flex items-center gap-2">OS Distribution</h2>
          {dataHosts.length > 0 ? (
            <div className="flex flex-col flex-1 items-center justify-center relative">
               <div className="w-full h-[180px]">
                 <ResponsiveContainer width="100%" height="100%">
                   <PieChart>
                     <Pie data={dataHosts} innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value" stroke="none">
                       {dataHosts.map((entry, index) => ( <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} /> ))}
                     </Pie>
                     <Tooltip contentStyle={{ backgroundColor: '#111217', border: '1px solid #2E2F3A', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                   </PieChart>
                 </ResponsiveContainer>
                 <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none mt-4">
                    <span className="text-xl font-bold text-white">{totalAgents}</span>
                    <span className="text-[10px] text-gray-400 uppercase">Agents</span>
                 </div>
               </div>
               <div className="w-full mt-4 space-y-2">
                 {dataHosts.map((entry, i) => (
                    <div key={entry.name} className="flex items-center justify-between text-xs bg-[#25262E] px-3 py-1.5 rounded-md">
                       <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                          <span className="text-gray-300 font-medium">{entry.name}</span>
                       </div>
                       <span className="text-gray-400">{((entry.value / totalAgents) * 100).toFixed(1)}%</span>
                    </div>
                 ))}
               </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-2">
              <PieChart size={40} className="opacity-20" />
              <span>No OS data recorded</span>
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Lists (Old Recent Detections + New Top Devices) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Most Recent Detections (From Old) */}
        <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] shadow-md p-5 flex flex-col max-h-[400px]">
          <h2 className="text-base font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <Zap size={18} className="text-amber-400" /> Recent Detections
          </h2>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.slice(0, 8).map(alert => <AlertItem key={alert.id} alert={alert} />)}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 py-10">
                <ShieldCheck size={32} className="mb-2 text-green-500/50" />
                <p>No recent alerts! System secure.</p>
              </div>
            )}
          </div>
        </div>

        {/* Top Devices by Detection Alerts (From New) */}
        <div className="bg-[#1C1D24] rounded-xl border border-[#2E2F3A] shadow-md p-5 flex flex-col max-h-[400px]">
          <h2 className="text-base font-semibold text-gray-300 mb-4 flex items-center gap-2">
             <Monitor size={18} className="text-blue-400" /> Top Devices by Detection
          </h2>
          <div className="flex-1 flex flex-col gap-3">
            {topDevices.length > 0 ? (
              topDevices.map((item, index) => (
                <div key={item.id} className="flex items-center justify-between border border-[#2E2F3A] rounded-lg p-3 bg-[#25262E]/30">
                  <div className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded-full bg-[#111217] border border-[#3A3B45] text-xs font-bold flex items-center justify-center text-blue-300">
                      {index + 1}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-gray-200">{item.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                         <Activity size={10} /> Active tracking
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-sm bg-[#111217] px-3 py-1 rounded border border-[#3A3B45] text-gray-300">
                     {item.count} detections
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-10">No detections recorded yet.</div>
            )}
            
            {Array.from({ length: Math.max(0, 3 - topDevices.length) }).map((_, i) => (
               <div key={`empty-${i}`} className="flex items-center justify-between border border-[#2E2F3A] border-dashed rounded-lg p-3 bg-transparent opacity-30">
                  <div className="flex items-center gap-4">
                     <div className="w-6 h-6 rounded-full bg-[#111217] border border-[#3A3B45] text-xs font-bold flex items-center justify-center text-gray-600">
                        {topDevices.length + i + 1}
                     </div>
                     <div className="w-32 h-4 bg-gray-700 rounded animate-pulse"></div>
                  </div>
               </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
