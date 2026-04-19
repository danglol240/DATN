import React, { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Events from './pages/Events';
import Alerts from './pages/Alerts';
import ToastContainer, { useToast } from './components/Toast';
import { useSocket } from './hooks/useSocket';
import { LayoutDashboard, Server, Activity, ShieldAlert, Menu, Wifi, WifiOff } from 'lucide-react';

function App() {
  const [page, setPage] = useState('dashboard');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const { connected, on } = useSocket();
  const { toasts, addToast, removeToast } = useToast();

  // Global socket listeners — alert + agent status toasts
  useEffect(() => {
    const offAlert = on('alert_notification', ({ alert }) => {
      const host = alert?.agentHostname ? `[${alert.agentHostname}] ` : '';
      const type = alert?.severity === 'Critical' ? 'error' : 'warning';
      addToast(`🚨 ${host}${alert?.ruleName}: ${alert?.description}`, type);
    });

    const offConn = on('agent_connected', ({ agentId }) => {
      addToast(`Agent connected`, 'success', 3000);
    });

    const offDisconn = on('agent_disconnected', ({ agentId }) => {
      addToast(`Agent disconnected`, 'warning', 3000);
    });

    return () => { offAlert(); offConn(); offDisconn(); };
  }, [on, addToast]);

  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'agents',    icon: Server,          label: 'Agents' },
    { id: 'events',    icon: Activity,        label: 'Events' },
    { id: 'alerts',    icon: ShieldAlert,     label: 'Alerts' },
  ];

  return (
    <div className="min-h-screen bg-[#111217] text-gray-200 font-sans flex">
      <aside className={`bg-[#1C1D24] border-r border-[#2E2F3A] flex flex-col transition-all duration-300 ${isSidebarOpen ? 'w-64' : 'w-20'}`}>
        <div className="h-[72px] flex items-center justify-between px-4 border-b border-[#2E2F3A]">
          {isSidebarOpen && (
            <div className="font-bold text-xl tracking-wide text-white truncate pl-2">
              <span className="text-[#FF2E63]">Final</span>PROJECT
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className={`p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#25262E] transition ${!isSidebarOpen ? 'mx-auto' : ''}`}
          >
            <Menu size={22} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4 flex-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              title={!isSidebarOpen ? item.label : ''}
              className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition
                ${page === item.id
                  ? 'bg-[#25262E] text-white border border-[#3A3B45]'
                  : 'text-gray-400 hover:text-white hover:bg-[#25262E]/50'}
                ${!isSidebarOpen ? 'justify-center border border-transparent' : ''}`}
            >
              <item.icon size={20} className="shrink-0" />
              {isSidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </div>

        {/* Real-time connection status indicator */}
        <div className={`px-4 py-3 border-t border-[#2E2F3A] flex items-center gap-2 text-xs ${!isSidebarOpen ? 'justify-center' : ''}`}>
          {connected ? (
            <>
              <Wifi size={14} className="text-green-400 shrink-0" />
              {isSidebarOpen && <span className="text-green-400">Live</span>}
            </>
          ) : (
            <>
              <WifiOff size={14} className="text-gray-500 shrink-0" />
              {isSidebarOpen && <span className="text-gray-500">Reconnecting…</span>}
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto h-screen relative">
        <div className="min-h-full">
          {page === 'dashboard' && <Dashboard />}
          {page === 'agents'    && <Agents />}
          {page === 'events'    && <Events />}
          {page === 'alerts'    && <Alerts />}
        </div>
      </main>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

export default App;
