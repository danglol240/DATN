import React, { useState, useEffect } from 'react';
import { useAgents } from '../hooks/useApi';
import { ShieldAlert, Save, RefreshCw } from 'lucide-react';

export default function RulesConfig() {
  const { data: agents } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState('');
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (agents?.length > 0 && !selectedAgent) setSelectedAgent(agents[0].id);
  }, [agents, selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) return;
    setLoading(true);
    setFeedback(null);
    fetch(`http://localhost:3000/api/agents/${selectedAgent}/rules`)
      .then(res => res.json())
      .then(data => { setRules(data.rules || []); setLoading(false); })
      .catch(err => { setFeedback({ type: 'err', msg: err.message }); setLoading(false); });
  }, [selectedAgent]);

  const toggleRule = (ruleId) => setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r));

  const saveConfig = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const configObj = rules.reduce((acc, r) => ({ ...acc, [r.id]: r.enabled }), {});
      const res = await fetch(`http://localhost:3000/api/agents/${selectedAgent}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: configObj }),
      });
      if (!res.ok) throw new Error('Không thể lưu cấu hình');
      setFeedback({ type: 'ok', msg: 'Đã lưu cấu hình rule cho agent này' });
    } catch (err) {
      setFeedback({ type: 'err', msg: err.message });
    } finally { setLoading(false); }
  };

  return (
    <div className="p-6 pb-20 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-white opacity-90 flex items-center gap-2"><ShieldAlert className="text-[#E8912E]" /> Rule Configuration</h1>
        <p className="text-sm text-gray-400 mt-1">Cấu hình engine phát hiện (Rule Engine) cho từng Agent riêng biệt.</p>
      </header>

      <div className="bg-[#1C1D24] p-6 rounded-xl border border-gray-800 shadow-md">
        <div className="flex gap-4 items-end mb-8 border-b border-[#2E2F3A] pb-6">
          <div className="flex flex-col gap-2 flex-1">
            <label className="text-sm text-gray-400 font-medium">Chọn Agent để cấu hình:</label>
            <select className="bg-[#25262E] border border-[#3A3B45] text-white text-sm rounded-lg px-4 py-2.5" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
              <option value="" disabled>-- Vui lòng chọn Agent --</option>
              {agents?.map(a => <option key={a.id} value={a.id}>{a.hostname} ({a.ip})</option>)}
            </select>
          </div>
          <button onClick={saveConfig} disabled={loading || !selectedAgent} className="flex items-center gap-2 bg-[#E8912E] text-white px-5 py-2.5 rounded-lg disabled:opacity-50">
            {loading ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />} Lưu cấu hình
          </button>
        </div>

        {feedback && <div className={`mb-6 px-4 py-3 rounded-lg text-sm ${feedback.type === 'ok' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{feedback.msg}</div>}

        <div className="space-y-3">
          {rules.length > 0 ? rules.map((r) => (
            <div key={r.id} className={`flex items-center justify-between p-4 rounded-lg border ${r.enabled ? 'bg-[#25262E] border-[#3A3B45]' : 'bg-[#1a1b20] border-gray-800 opacity-60'}`}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-gray-700 px-2 py-0.5 rounded text-white">{r.id}</span>
                  <span className="font-semibold text-white">{r.name}</span>
                  <span className="text-[10px] text-orange-400 border border-orange-800 px-2 py-0.5 rounded-full">{r.severity}</span>
                </div>
              </div>
              <input type="checkbox" checked={r.enabled} onChange={() => toggleRule(r.id)} className="w-5 h-5 accent-[#E8912E]" />
            </div>
          )) : <div className="text-center py-8 text-gray-500">Vui lòng chọn Agent.</div>}
        </div>
      </div>
    </div>
  );
}
