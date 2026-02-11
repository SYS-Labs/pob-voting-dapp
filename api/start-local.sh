#!/usr/bin/env bash
set -euo pipefail

# Starts the API server and workers against a fresh temporary database.
# Intended for local development alongside start-hardhat.sh and fake-ipfs.
#
# Usage:
#   ./start-local.sh              # defaults: API on 4000, IPFS on 5001, RPC on 8547
#   API_PORT=4001 ./start-local.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"

# ── Temporary database ────────────────────────────────────────────────────
DB_DIR=$(mktemp -d)
DB_FILE="${DB_DIR}/pob-local.db"
echo "Database: ${DB_FILE}"

# ── Resolve local contract addresses from latest Hardhat deployment ───────
DEPLOYMENT_FILE=$(ls -t ../contracts/deployment-iteration-*-localhost-*.json 2>/dev/null | head -1 || true)

if [[ -n "${DEPLOYMENT_FILE}" ]]; then
  echo "Using deployment: ${DEPLOYMENT_FILE}"
  # Extract addresses from deployment JSON
  REGISTRY_ADDRESS=$(node -e "const d=JSON.parse(require('fs').readFileSync('${DEPLOYMENT_FILE}','utf8')); console.log(d.contracts?.PoBRegistry?.proxy || '')")
  FORUM_CONTRACT=$(node -e "const d=JSON.parse(require('fs').readFileSync('${DEPLOYMENT_FILE}','utf8')); console.log(d.contracts?.ForumOracle || '')")
  DEPLOYER=$(node -e "const d=JSON.parse(require('fs').readFileSync('${DEPLOYMENT_FILE}','utf8')); console.log(d.deployer || '')")
  CERT_NFT_ADDRESS=$(node -e "const d=JSON.parse(require('fs').readFileSync('${DEPLOYMENT_FILE}','utf8')); console.log(d.contracts?.CertNFT?.proxy || d.contracts?.CertNFT || '')")
else
  echo "Warning: No Hardhat deployment file found. Run contracts/start-hardhat.sh first."
  REGISTRY_ADDRESS=""
  FORUM_CONTRACT=""
  DEPLOYER=""
  CERT_NFT_ADDRESS=""
fi

# ── Environment for local dev ─────────────────────────────────────────────
# Use Hardhat's first account private key (from contracts/.env mnemonic)
LOCAL_PRIVATE_KEY="${PRIVATE_KEY:-0x3ca5e88bf1a5c66e36734b791b787597fbac7d7622ffb3590a7be18ecc9580c9}"
LOCAL_ADMIN="${ADMIN_ADDRESS:-${DEPLOYER:-0x782b29fA3304F9f456bdbb3eA16bc036B88AE415}}"
LOCAL_CONTRACT="${CONTRACT_ADDRESS:-${FORUM_CONTRACT:-0x0000000000000000000000000000000000000000}}"
LOCAL_RPC="${RPC_URL:-http://localhost:8547}"
LOCAL_IPFS="${IPFS_API_URL:-http://localhost:5001}"

export DB_PATH="${DB_FILE}"
export PRIVATE_KEY="${LOCAL_PRIVATE_KEY}"
export ADMIN_ADDRESS="${LOCAL_ADMIN}"
export CONTRACT_ADDRESS="${LOCAL_CONTRACT}"
export RPC_URL="${LOCAL_RPC}"
export CHAIN_ID="${CHAIN_ID:-31337}"
export EXPLORER_URL="${EXPLORER_URL:-}"
export IPFS_API_URL="${LOCAL_IPFS}"
export IPFS_FALLBACK_API_URL=""
export AI_API_KEY="${AI_API_KEY:-sk-fake-local-dev-key}"
export AI_API_ENDPOINT="${AI_API_ENDPOINT:-https://api.openai.com/v1}"
export AI_MODEL="${AI_MODEL:-gpt-4o-mini}"
export REGISTRY_CONTRACT_ADDRESS="${REGISTRY_ADDRESS}"
export CERT_NFT_CONTRACT_ADDRESS="${CERT_NFT_ADDRESS}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export WORKER_INTERVAL="${WORKER_INTERVAL:-30000}"
export API_PORT="${API_PORT:-4000}"

# ── Initialize database ──────────────────────────────────────────────────
echo "Initializing database..."
npx tsx src/db/init.ts

# ── Cleanup ───────────────────────────────────────────────────────────────
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    if ps -p "${pid}" > /dev/null 2>&1; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
  for pid in "${PIDS[@]}"; do
    wait "${pid}" 2>/dev/null || true
  done
  rm -rf "${DB_DIR}"
  echo "Cleaned up (database removed)."
}

trap cleanup EXIT INT TERM

# ── Start services ────────────────────────────────────────────────────────
echo ""
echo "Starting API server on port ${API_PORT}..."
npx tsx src/api/index.ts &
PIDS+=($!)

echo "Starting workers..."
npx tsx src/workers/index.ts &
PIDS+=($!)

echo "Starting iteration indexer..."
npx tsx src/indexer/iteration-indexer.ts &
PIDS+=($!)

echo "Starting cert indexer..."
npx tsx src/indexer/cert-indexer.ts &
PIDS+=($!)

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║   API + Workers + Indexer running locally  ║"
echo "╠════════════════════════════════════════════╣"
echo "║  API:      http://localhost:${API_PORT}             ║"
echo "║  RPC:      ${LOCAL_RPC}       ║"
echo "║  IPFS:     ${LOCAL_IPFS}      ║"
echo "║  Chain ID: ${CHAIN_ID}                            ║"
echo "║  DB:       (temp, wiped on exit)           ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop."

wait "${PIDS[0]}"
