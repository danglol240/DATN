/**
 * Detection Rule Engine
 * Phân tích event gửi lên từ Agent và tạo Alert nếu khớp rule.
 */

const RULES = [
  {
    id: 'R001',
    name: 'Reverse Shell Detected',
    severity: 'Critical',
    match: (event) => event.type === 'Network' && JSON.parse(event.data || '{}')?.connection?.remote_port === 4444,
    description: (event) => `Phát hiện kết nối Reverse Shell tới cổng 4444.`
  },
  {
    id: 'R002',
    name: 'C2 Communication - RAT Port',
    severity: 'Critical',
    match: (event) => {
      const d = JSON.parse(event.data || '{}');
      return event.type === 'Network' && [1337, 666, 6667].includes(d?.connection?.remote_port);
    },
    description: (event) => {
      const d = JSON.parse(event.data || '{}');
      return `Phát hiện giao tiếp C2 nghi ngờ tới cổng ${d?.connection?.remote_port}.`;
    }
  },
  {
    id: 'R003',
    name: 'Suspicious IP Blocked',
    severity: 'High',
    match: (event) => {
      const d = JSON.parse(event.data || '{}');
      return event.type === 'Network' && 
             (d?.action === 'blocked_ip' || 
             (d?.action === 'added_rule' && (d?.target === 'DROP' || d?.target === 'REJECT') && d?.src));
    },
    description: (event) => {
      const d = JSON.parse(event.data || '{}');
      const ip = d?.action === 'blocked_ip' ? d?.connection?.remote_ip : d?.src;
      return `IP đáng ngờ ${ip} đã bị chặn bởi iptables${d?.port ? ` (Port: ${d.port})` : ''}.`;
    }
  },
  {
    id: 'R004',
    name: 'High CPU Usage',
    severity: 'Medium',
    match: (event) => event.type === 'Process' && JSON.parse(event.data || '{}')?.cpu_percent > 90,
    description: (event) => `Phát hiện CPU sử dụng quá mức: ${JSON.parse(event.data || '{}')?.cpu_percent}%.`
  },
  {
    id: 'R005',
    name: 'Custom Firewall Rule Applied',
    severity: 'Medium',
    match: (event) => {
      const d = JSON.parse(event.data || '{}');
      return event.type === 'Network' && d?.action === 'added_rule' && !( (d?.target === 'DROP' || d?.target === 'REJECT') && d?.src );
    },
    description: (event) => {
      const d = JSON.parse(event.data || '{}');
      return `Quy tắc tường lửa mới được thêm (Chain: ${d?.chain}, Target: ${d?.target}${d?.port ? `, Port: ${d?.port}` : ''}).`;
    }
  },
  {
    id: 'R006',
    name: 'Custom Firewall Rule Removed',
    severity: 'Medium',
    match: (event) => event.type === 'Network' && JSON.parse(event.data || '{}')?.action === 'deleted_rule',
    description: (event) => {
      const d = JSON.parse(event.data || '{}');
      return `Quy tắc tường lửa bị xoá (Chain: ${d?.chain}${d?.num ? `, Dòng: ${d?.num}` : ''}).`;
    }
  }
];

function detectRules(event, agentConfig = {}) {
  const matchedAlerts = [];
  for (const rule of RULES) {
    if (agentConfig[rule.id] === false) continue; // Skip disabled rules
    try {
      if (rule.match(event)) {
        matchedAlerts.push({
          agentId: event.agentId,
          severity: rule.severity,
          ruleName: `[${rule.id}] ${rule.name}`,
          description: rule.description(event)
        });
      }
    } catch (e) {
      // Ignore rule matching errors
    }
  }
  return matchedAlerts;
}

module.exports = { detectRules, RULES };
