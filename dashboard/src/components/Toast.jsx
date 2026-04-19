import React, { useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const CONFIG = {
  success: { Icon: CheckCircle, cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  error:   { Icon: XCircle,     cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  warning: { Icon: AlertTriangle, cls: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  info:    { Icon: Info,         cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
};

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // cap at 5
    if (duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    }
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

export default function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(({ id, message, type }) => {
        const { Icon, cls } = CONFIG[type] || CONFIG.info;
        return (
          <div
            key={id}
            className={`flex items-start gap-3 p-3.5 rounded-xl border shadow-2xl text-sm pointer-events-auto ${cls}`}
          >
            <Icon size={16} className="shrink-0 mt-0.5" />
            <span className="flex-1 text-gray-200 break-words">{message}</span>
            <button
              onClick={() => removeToast(id)}
              className="text-gray-500 hover:text-white shrink-0 mt-0.5"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
