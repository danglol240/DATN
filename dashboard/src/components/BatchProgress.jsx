import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader, X } from 'lucide-react';
import { useSocket } from '../hooks/useSocket';

export default function BatchProgress({ batchJobId, total, initialSuccess = 0, initialFailed = 0, onClose }) {
  const [progress, setProgress] = useState({
    success: initialSuccess,
    failed: initialFailed,
    status: 'dispatched',
  });
  const { on } = useSocket();

  const done = progress.success + progress.failed;
  const pct  = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = done >= total;

  useEffect(() => {
    if (!batchJobId) return;
    return on('batch_progress', (data) => {
      if (data.batchJobId === batchJobId) {
        setProgress({ success: data.success, failed: data.failed, status: data.status });
      }
    });
  }, [on, batchJobId]);

  const barColor =
    progress.status === 'success'         ? 'bg-green-500' :
    progress.status === 'partial_failure' ? 'bg-orange-500' :
    progress.status === 'failure'         ? 'bg-red-500' : 'bg-blue-500';

  return (
    <div className="bg-[#1C1D24] border border-[#2E2F3A] rounded-xl shadow-2xl p-4 w-80">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">
          Batch Command — {total} device{total !== 1 ? 's' : ''}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors p-1 rounded"
        >
          <X size={14} />
        </button>
      </div>

      <div className="w-full bg-[#111217] rounded-full h-1.5 mb-3">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs mb-2">
        <span className="flex items-center gap-1 text-green-400">
          <CheckCircle size={12} /> {progress.success} ok
        </span>
        <span className="text-gray-500">{pct}%</span>
        <span className={`flex items-center gap-1 ${progress.failed > 0 ? 'text-red-400' : 'text-gray-600'}`}>
          <XCircle size={12} /> {progress.failed} failed
        </span>
      </div>

      {!isComplete && (
        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
          <Loader size={11} className="animate-spin" />
          Waiting for agents to respond…
        </div>
      )}

      {isComplete && progress.failed > 0 && (
        <p className="text-xs text-orange-400 mt-1">
          {progress.failed} agent(s) failed — will retry automatically.
        </p>
      )}

      {isComplete && progress.failed === 0 && (
        <p className="text-xs text-green-400 mt-1">All agents completed successfully.</p>
      )}
    </div>
  );
}
