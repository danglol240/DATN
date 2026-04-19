import React, { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Events from './pages/Events';
import Alerts from './pages/Alerts';
import { LayoutDashboard, Server, Activity, ShieldAlert, Menu } from 'lucide-react';

function App() {
  const [page, setPage] = useState('dashboard');
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'agents', icon: Server, label: 'Agents' },
    { id: 'events', icon: Activity, label: 'Events' },
    { id: 'alerts', icon: ShieldAlert, label: 'Alerts' }
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
              title={!isSidebarOpen ? item.label : ""}
              className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition ${page === item.id ? 'bg-[#25262E] text-white border border-[#3A3B45]' : 'text-gray-400 hover:text-white hover:bg-[#25262E]/50'} ${!isSidebarOpen && 'justify-center border border-transparent'}`}
            >
              <item.icon size={20} className="shrink-0" />
              {isSidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto h-screen relative">
        <div className="min-h-full">
          {page === 'dashboard' && <Dashboard />}
          {page === 'agents' && <Agents />}
          {page === 'events' && <Events />}
          {page === 'alerts' && <Alerts />}
        </div>
      </main>
    </div>
  );
}

export default App;
