const { PrismaClient } = require('@prisma/client');
const { X509Certificate } = require('crypto');
const { logAudit } = require('../lib/audit');

const prisma = new PrismaClient();

function parseCertInfo(certPem) {
  try {
    const cert = new X509Certificate(certPem);
    return {
      subject:     cert.subject,
      validFrom:   cert.validFrom,
      validTo:     cert.validTo,
      fingerprint: cert.fingerprint,
    };
  } catch {
    return null;
  }
}

// POST /api/agents/:agentId/keys
// Body: { certPem, keyPem, label? }
exports.addKey = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { certPem, keyPem, label } = req.body;

    if (!certPem || !keyPem)
      return res.status(400).json({ error: 'certPem và keyPem là bắt buộc' });

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent không tồn tại' });

    try {
      new X509Certificate(certPem);
    } catch {
      return res.status(400).json({ error: 'certPem không đúng định dạng PEM' });
    }

    const agentKey = await prisma.agentKey.upsert({
      where:  { agentId },
      create: { agentId, certPem, keyPem, label: label || null, addedBy: req.user?.username },
      update: { certPem, keyPem, label: label || null, addedBy: req.user?.username, addedAt: new Date() },
    });

    await logAudit(req, 'AGENT_KEY_ADD', `agent:${agentId}`, `label=${label || ''}`, 'success');
    const { keyPem: _k, ...safeKey } = agentKey;
    res.status(201).json({ ...safeKey, certInfo: parseCertInfo(certPem) });
  } catch (err) {
    console.error('[AgentKey] addKey error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/agents/:agentId/keys
// Trả về cert info nhưng KHÔNG trả keyPem
exports.getKey = async (req, res) => {
  try {
    const key = await prisma.agentKey.findUnique({ where: { agentId: req.params.agentId } });
    if (!key) return res.status(404).json({ error: 'Chưa có key cho agent này' });

    const { keyPem: _k, ...safeKey } = key;
    res.json({ ...safeKey, certInfo: parseCertInfo(key.certPem) });
  } catch (err) {
    console.error('[AgentKey] getKey error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// DELETE /api/agents/:agentId/keys
exports.deleteKey = async (req, res) => {
  try {
    const existing = await prisma.agentKey.findUnique({ where: { agentId: req.params.agentId } });
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy key' });

    await prisma.agentKey.delete({ where: { agentId: req.params.agentId } });
    await logAudit(req, 'AGENT_KEY_DELETE', `agent:${req.params.agentId}`, null, 'success');
    res.json({ ok: true });
  } catch (err) {
    console.error('[AgentKey] deleteKey error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/agents/:agentId/keys/export  — admin only
// Trả về cert + key đầy đủ để copy sang agent machine
exports.exportKey = async (req, res) => {
  try {
    const key = await prisma.agentKey.findUnique({ where: { agentId: req.params.agentId } });
    if (!key) return res.status(404).json({ error: 'Chưa có key cho agent này' });

    await logAudit(req, 'AGENT_KEY_EXPORT', `agent:${req.params.agentId}`, null, 'success');
    res.json({ certPem: key.certPem, keyPem: key.keyPem, label: key.label });
  } catch (err) {
    console.error('[AgentKey] exportKey error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
