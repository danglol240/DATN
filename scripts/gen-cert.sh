#!/usr/bin/env bash
# Tạo CA + TLS cert cho backend và agent (installer bundle).
#
# Kiến trúc:
#   ca-service/certs/  ← CA key + CA cert (chỉ CA service giữ)
#   backend/certs/     ← backend cert + ca-cert (public, để verify agent)
#   agent/certs/       ← ca-cert (public, đóng gói vào installer)
#
# ca-key.pem KHÔNG có mặt trên backend hay agent.
#
# Sau khi chạy, cấu hình:
#   ca-service/.env:
#     CA_TOKEN=<secret dài ngẫu nhiên>
#     CERTS_DIR=./certs
#
#   backend/.env:
#     SSL_CERT=./certs/backend-cert.pem
#     SSL_KEY=./certs/backend-key.pem
#     AGENT_CA_CERT=./certs/ca-cert.pem
#     BACKEND_CERT=./certs/backend-cert.pem
#     BACKEND_KEY=./certs/backend-key.pem
#     CA_SERVICE_URL=http://127.0.0.1:8888
#     CA_TOKEN=<cùng secret với ca-service>
#
#   agent/config.yaml:
#     ssl_verify: ./certs/ca-cert.pem
#     ca_cert:    ./certs/ca-cert.pem

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CA_SERVICE_CERTS="$ROOT/ca-service/certs"
BACKEND_CERTS="$ROOT/backend/certs"
AGENT_CERTS="$ROOT/agent/certs"
TMP=$(mktemp -d)

mkdir -p "$CA_SERVICE_CERTS" "$BACKEND_CERTS" "$AGENT_CERTS"

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo "[gen-cert] LOCAL_IP = $LOCAL_IP"
echo ""

# ─── 1. CA — chỉ nằm trong ca-service/certs/ ─────────────────────────────────

CA_KEY="$CA_SERVICE_CERTS/ca-key.pem"
CA_CERT="$CA_SERVICE_CERTS/ca-cert.pem"

if [ -f "$CA_CERT" ] && [ -f "$CA_KEY" ]; then
  echo "[gen-cert] CA đã tồn tại — dùng lại để ký cert mới."
  echo "           Xoá $CA_KEY nếu muốn tạo CA mới."
else
  echo "[gen-cert] Tạo CA..."
  openssl genrsa -out "$CA_KEY" 4096 2>/dev/null
  openssl req -new -x509 -days 3650 \
    -key  "$CA_KEY" \
    -out  "$CA_CERT" \
    -subj "/CN=EDR-CA/O=EDR/C=VN"
  echo "[gen-cert] CA cert → $CA_CERT"
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

# Backend chỉ cần ca-cert (public) để verify agent cert — KHÔNG cần ca-key
cp "$CA_CERT" "$BACKEND_CERTS/ca-cert.pem"

echo "[gen-cert] Backend cert → $BACKEND_CERTS/backend-cert.pem (hạn 365 ngày)"
echo ""

# ─── 3. CA cert cho agent installer ──────────────────────────────────────────
echo "[gen-cert] Copy ca-cert vào agent/certs/ (đóng gói vào installer)..."

# Chỉ copy ca-cert.pem (public) — agent tự sinh key + cert riêng lúc enrollment
cp "$CA_CERT" "$AGENT_CERTS/ca-cert.pem"

echo "[gen-cert] ca-cert → $AGENT_CERTS/ca-cert.pem"

# ─── Cleanup ──────────────────────────────────────────────────────────────────
rm -rf "$TMP"

# ─── Hướng dẫn ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo " Cấu hình:"
echo "════════════════════════════════════════════════════"
echo ""
echo " ca-service/.env:"
echo "   CA_TOKEN=$(openssl rand -hex 32)"
echo "   CERTS_DIR=./certs"
echo ""
echo " backend/.env:"
echo "   SSL_CERT=./certs/backend-cert.pem"
echo "   SSL_KEY=./certs/backend-key.pem"
echo "   AGENT_CA_CERT=./certs/ca-cert.pem"
echo "   BACKEND_CERT=./certs/backend-cert.pem"
echo "   BACKEND_KEY=./certs/backend-key.pem"
echo "   CA_SERVICE_URL=http://127.0.0.1:8888"
echo "   CA_TOKEN=<cùng token với ca-service>"
echo ""
echo " agent/config.yaml: không đổi"
echo ""
echo " QUAN TRỌNG:"
echo "   ca-key.pem chỉ nằm trong ca-service/certs/"
echo "   Backend và agent KHÔNG có ca-key.pem"
echo "════════════════════════════════════════════════════"
