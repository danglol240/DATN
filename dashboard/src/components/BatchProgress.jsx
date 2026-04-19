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

  const statusText =
    progress.status === 'success'         ? 'Thành công' :
    progress.status === 'partial_failure' ? 'Thất bại một phần' :
    progress.status === 'failure'         ? 'Thất bại hoàn toàn' :
    progress.status === 'retrying'        ? 'Đang thử lại…' :
    progress.status === 'dispatching'     ? 'Đang gửi…' : 'Đã gửi';

  const statusColor =
    progress.status === 'success'         ? 'text-green-400' :
    progress.status === 'partial_failure' ? 'text-orange-400' :
    progress.status === 'failure'         ? 'text-red-400' : 'text-blue-400';

  return (
    <div className="bg-[#1C1D24]/90 backdrop-blur-sm border border-[#2E2F3A] rounded-md shadow-2xl overflow-hidden w-full max-w-2xl text-sm">

      {/* Header */}
      <div className="bg-[#25262E]/90 px-6 py-4 border-b border-[#3A3B45] flex items-center justify-between">
        <h2 className="font-semibold text-white">
          Batch Command Progress
        </h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-1"
        >
          <X size={18} />
        </button>
      </div>

      {/* Progress Row */}
      <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
        <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">
          Tiến Trình
        </div>
        <div className="p-4 bg-[#21222C]/70">
          <div className="flex items-center gap-4 mb-3">
            <div className="flex-1">
              <div className="w-full bg-[#25262E] rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <span className={`font-mono font-bold min-w-12 text-right ${statusColor}`}>
              {pct}%
            </span>
          </div>
          <p className="text-gray-500 text-xs">
            {done}/{total} thiết bị — {isComplete ? 'Hoàn thành' : 'Đang xử lý'}
          </p>
        </div>
      </div>

      {/* Success Row */}
      <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
        <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">
          Thành Công
        </div>
        <div className="p-4 bg-[#21222C]/70">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={14} className="text-green-400" />
            <span className="text-green-400 font-mono font-bold">
              {progress.success}
            </span>
            <span className="text-gray-500">/</span>
            <span className="text-gray-400 font-mono">
              {total}
            </span>
          </div>
          <p className="text-gray-500 text-xs">
            Số device thực thi thành công
          </p>
        </div>
      </div>

      {/* Failed Row */}
      <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
        <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">
          Thất Bại
        </div>
        <div className="p-4 bg-[#21222C]/70">
          <div className="flex items-center gap-2 mb-1">
            <XCircle size={14} className={progress.failed > 0 ? 'text-red-400' : 'text-gray-600'} />
            <span className={progress.failed > 0 ? 'text-red-400 font-mono font-bold' : 'text-gray-600 font-mono font-bold'}>
              {progress.failed}
            </span>
            <span className="text-gray-500">/</span>
            <span className="text-gray-400 font-mono">
              {total}
            </span>
          </div>
          <p className="text-gray-500 text-xs">
            {progress.failed === 0 ? 'Không có device nào thất bại' : 'Số device thất bại'}
          </p>
        </div>
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-[200px_1fr] border-b border-[#2E2F3A]/50">
        <div className="bg-[#25262E]/80 p-4 text-right pr-6 font-medium text-white flex items-center justify-end">
          Trạng Thái
        </div>
        <div className="p-4 bg-[#21222C]/70">
          <div className="flex items-center gap-3 mb-1">
            {!isComplete ? (
              <Loader size={14} className="animate-spin text-blue-400" />
            ) : progress.failed === 0 ? (
              <CheckCircle size={14} className="text-green-400" />
            ) : (
              <XCircle size={14} className={progress.status === 'failure' ? 'text-red-400' : 'text-orange-400'} />
            )}
            <span className={`font-medium ${statusColor}`}>
              {statusText}
            </span>
          </div>
          <p className="text-gray-500 text-xs">
            {!isComplete && 'Chờ agent phản hồi…'}
            {isComplete && progress.failed === 0 && 'Tất cả agent đã hoàn thành.'}
            {isComplete && progress.failed > 0 && progress.status !== 'max_retries_reached' && 'Thất bại sẽ được retry tự động.'}
            {progress.status === 'max_retries_reached' && 'Đạt giới hạn retry.'}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-[#25262E]/80 p-4 flex gap-3 justify-end border-t border-[#3A3B45]">
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2 bg-gray-600/80 hover:bg-gray-500 text-white rounded shadow transition font-medium text-sm"
        >
          Đóng
        </button>
      </div>
    </div>
  );
}
