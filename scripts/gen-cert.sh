#!/usr/bin/env bash
# Tạo CA + CA-signed TLS cert cho backend và agent.
#
# Luồng:
#   1. Sinh CA key + CA cert (root of trust)
#   2. Sinh backend cert ký bởi CA → backend/certs/
#   3. Sinh agent cert ký bởi CA   → agent/certs/
#   4. Copy ca-cert.pem sang cả 2 thư mục (mỗi bên verify nhau qua CA chung)
#
# Sau khi chạy, thêm vào backend/.env:
#   SSL_CERT=./certs/backend-cert.pem
#   SSL_KEY=./certs/backend-key.pem
#   AGENT_CA_CERT=./certs/ca-cert.pem
#
# Agent config.yaml:
#   agent_cert: ./certs/agent-cert.pem
#   agent_key:  ./certs/agent-key.pem
#   ssl_verify: ./certs/ca-cert.pem

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_CERTS="$ROOT/backend/certs"
AGENT_CERTS="$ROOT/agent/certs"
TMP=$(mktemp -d)

mkdir -p "$BACKEND_CERTS" "$AGENT_CERTS"

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo "[gen-cert] LOCAL_IP = $LOCAL_IP"
echo ""

# ─── 1. CA ────────────────────────────────────────────────────────────────────
# CA key + cert dùng chung, chỉ sinh 1 lần.
# Ai có ca-key.pem có thể ký cert mới — giữ bí mật, không deploy lên server.

CA_KEY="$BACKEND_CERTS/ca-key.pem"
CA_CERT="$BACKEND_CERTS/ca-cert.pem"

if [ -f "$CA_CERT" ] && [ -f "$CA_KEY" ]; then
  echo "[gen-cert] CA đã tồn tại — dùng lại để ký cert mới."
  echo "           Xoá $CA_CERT và $CA_KEY nếu muốn tạo CA mới."
else
  echo "[gen-cert] Tạo CA..."
  openssl genrsa -out "$CA_KEY" 4096 2>/dev/null
  openssl req -new -x509 -days 3650 \
    -key  "$CA_KEY" \
    -out  "$CA_CERT" \
    -subj "/CN=EDR-CA/O=EDR/C=VN"
  echo "[gen-cert] CA cert → $CA_CERT (hạn 10 năm)"
fi
echo ""

# ─── 2. Backend cert ──────────────────────────────────────────────────────────
echo "[gen-cert] Tạo backend cert..."

cat > "$TMP/backend-ext.cnf" <<EOF
subjectAltName=IP:127.0.0.1,IP:${LOCAL_IP},DNS:localhost
EOF

openssl genrsa -out "$BACKEND_CERTS/backend-key.pem" 2048 2>/dev/null

openssl req -new \
  -key  "$BACKEND_CERTS/backend-key.pem" \
  -out  "$TMP/backend-csr.pem" \
  -subj "/CN=edr-backend/O=EDR/C=VN"

openssl x509 -req -days 365 \
  -in      "$TMP/backend-csr.pem" \
  -CA      "$CA_CERT" \
  -CAkey   "$CA_KEY" \
  -CAcreateserial \
  -extfile "$TMP/backend-ext.cnf" \
  -out     "$BACKEND_CERTS/backend-cert.pem" 2>/dev/null

# Copy CA cert sang backend để backend biết CA nào được tin
cp "$CA_CERT" "$BACKEND_CERTS/ca-cert.pem"

echo "[gen-cert] Backend cert → $BACKEND_CERTS/backend-cert.pem (hạn 365 ngày)"
echo ""

# ─── 3. Agent cert ────────────────────────────────────────────────────────────
echo "[gen-cert] Tạo agent cert..."

cat > "$TMP/agent-ext.cnf" <<EOF
subjectAltName=IP:127.0.0.1,IP:${LOCAL_IP},DNS:localhost
EOF

openssl genrsa -out "$AGENT_CERTS/agent-key.pem" 2048 2>/dev/null

openssl req -new \
  -key  "$AGENT_CERTS/agent-key.pem" \
  -out  "$TMP/agent-csr.pem" \
  -subj "/CN=edr-agent/O=EDR/C=VN"

openssl x509 -req -days 365 \
  -in      "$TMP/agent-csr.pem" \
  -CA      "$CA_CERT" \
  -CAkey   "$CA_KEY" \
  -CAcreateserial \
  -extfile "$TMP/agent-ext.cnf" \
  -out     "$AGENT_CERTS/agent-cert.pem" 2>/dev/null

# Copy CA cert sang agent để agent verify cert của backend
cp "$CA_CERT" "$AGENT_CERTS/ca-cert.pem"

echo "[gen-cert] Agent cert → $AGENT_CERTS/agent-cert.pem (hạn 365 ngày)"

# ─── Cleanup ──────────────────────────────────────────────────────────────────
rm -rf "$TMP"

# ─── Hướng dẫn ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo " XONG. Cấu hình như sau:"
echo "════════════════════════════════════════════════════"
echo ""
echo " backend/.env:"
echo "   SSL_CERT=./certs/backend-cert.pem"
echo "   SSL_KEY=./certs/backend-key.pem"
echo "   AGENT_CA_CERT=./certs/ca-cert.pem"
echo ""
echo " agent/config.yaml:"
echo "   agent_cert: ./certs/agent-cert.pem"
echo "   agent_key:  ./certs/agent-key.pem"
echo "   ssl_verify: ./certs/ca-cert.pem"
echo ""
echo " LƯU Ý: ca-key.pem chỉ cần để ký cert — KHÔNG deploy lên server."
echo "════════════════════════════════════════════════════"
