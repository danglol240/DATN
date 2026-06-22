import { useState, useEffect, useCallback } from 'react';
import { getStoredToken } from './useAuth';

const BASE = '/api';

function authHeaders() {
  const token = getStoredToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

// Hook chung để poll dữ liệu từ API với interval tùy chỉnh
function usePoll(url, interval = 10000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (res.status === 401) {
        // Token hết hạn — xóa localStorage và reload để về màn login
        localStorage.removeItem('edr_token');
        localStorage.removeItem('edr_user');
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, interval);
    return () => clearInterval(id);
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}

// Các hook cụ thể cho từng loại dữ liệu

export function useStats() {
  return usePoll(`${BASE}/stats`, 8000);
}

export function useAgents() {
  return usePoll(`${BASE}/agents`, 10000);
}

export function useAlerts(params = '') {
  return usePoll(`${BASE}/alerts${params}`, 8000);
}

export function useEvents(params = '') {
  return usePoll(`${BASE}/events${params}`, 10000);
}

export function useCommandHistory(agentId) {
  const { data, loading, error, refetch } = usePoll(
    agentId ? `${BASE}/agents/${agentId}/commands/history` : null,
    5000
  );
  return { data, loading, error, refetch };
}

// Các hàm gọi API không dùng hook vì chỉ gọi khi có sự kiện (như click)

export async function sendCommand(agentId, action, params = {}) {
  const res = await fetch(`${BASE}/agents/${agentId}/commands`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) throw new Error(`sendCommand failed: HTTP ${res.status}`);
  return res.json();
}

export async function sendCommandBatch(agentIds, action, params = {}) {
  const res = await fetch(`${BASE}/commands/batch`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ agentIds, action, params }),
  });
  if (!res.ok) throw new Error(`sendCommandBatch failed: HTTP ${res.status}`);
  return res.json();
}

export async function resolveAlert(alertId) {
  const res = await fetch(`${BASE}/alerts/${alertId}/resolve`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`resolveAlert failed: HTTP ${res.status}`);
  return res.json();
}

// ─── Agent Key Management ─────────────────────────────────────────────────────

export async function getAgentKey(agentId) {
  const res = await fetch(`${BASE}/agents/${agentId}/keys`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getAgentKey failed: HTTP ${res.status}`);
  return res.json();
}

export async function addAgentKey(agentId, certPem, keyPem, label = '') {
  const res = await fetch(`${BASE}/agents/${agentId}/keys`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ certPem, keyPem, label }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function deleteAgentKey(agentId) {
  const res = await fetch(`${BASE}/agents/${agentId}/keys`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`deleteAgentKey failed: HTTP ${res.status}`);
  return res.json();
}

export async function exportAgentKey(agentId) {
  const res = await fetch(`${BASE}/agents/${agentId}/keys/export`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`exportAgentKey failed: HTTP ${res.status}`);
  return res.json();
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export function useAuditLogs(params = '') {
  return usePoll(`${BASE}/audit-logs${params}`, 15000);
}

export function getAuditLogExportUrl() {
  return `${BASE}/audit-logs/export`;
}
