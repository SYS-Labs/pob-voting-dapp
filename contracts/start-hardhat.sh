#!/usr/bin/env bash
set -euo pipefail

# Starts a Hardhat JSON-RPC node and deploys the contracts once the node is ready.

if [[ -f ".env" ]]; then
  echo "Loading environment variables from .env"
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

HOST=${HARDHAT_HOST:-0.0.0.0}
PORT=${HARDHAT_PORT:-8547}
NETWORK=${HARDHAT_NETWORK:-localhost}
LOG_FILE=${HARDHAT_LOG_FILE:-hardhat-node.log}

cleanup() {
  if [[ -n "${NODE_PID:-}" ]] && ps -p "${NODE_PID}" > /dev/null 2>&1; then
    echo "Stopping Hardhat node (PID ${NODE_PID})"
    kill "${NODE_PID}" >/dev/null 2>&1 || true
    wait "${NODE_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required to check Hardhat node readiness." >&2
  exit 1
fi

echo "Starting Hardhat node on ${HOST}:${PORT}..."
npx hardhat node --hostname "${HOST}" --port "${PORT}" > >(tee "${LOG_FILE}") 2>&1 &
NODE_PID=$!

MAX_ATTEMPTS=30
RPC_URL="http://${HOST}:${PORT}"
READY=false

echo -n "Waiting for Hardhat node to be ready"
for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  if curl --silent --fail --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    -H "Content-Type: application/json" \
    "${RPC_URL}" >/dev/null; then
    READY=true
    break
  fi
  sleep 1
  echo -n "."
done
echo

if [[ "${READY}" != "true" ]]; then
  echo "Error: Hardhat node did not become ready after ${MAX_ATTEMPTS} seconds." >&2
  exit 1
fi

echo "Deploying PoBRegistry to ${NETWORK} via scripts/deploy-pob-registry.js..."
npx hardhat run scripts/deploy-pob-registry.js --network "${NETWORK}"

echo "Deploying iteration contracts to ${NETWORK} via scripts/deploy.js..."
npx hardhat run scripts/deploy.js --network "${NETWORK}"

if [[ "${NETWORK}" == "localhost" || "${NETWORK}" == "hardhat" ]]; then
  echo "Seeding local iteration data via scripts/seed-local.js..."
  npx hardhat run scripts/seed-local.js --network "${NETWORK}"
fi

echo "Hardhat node is running. Logs are streaming to ${LOG_FILE}."
echo "Press Ctrl+C to stop the node."

wait "${NODE_PID}"
