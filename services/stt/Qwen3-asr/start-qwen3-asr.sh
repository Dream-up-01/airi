#!/usr/bin/env bash
set -euo pipefail

PORT="${QWEN3_ASR_PORT:-8001}"
MODEL="${QWEN3_ASR_MODEL:-Qwen/Qwen3-ASR-0.6B}"
VENV="${QWEN3_ASR_VENV:-/home/wyb/.venvs/qwen3-asr}"
HF_HOME="${HF_HOME:-/home/wyb/models/huggingface}"
GPU_MEMORY_UTILIZATION="${QWEN3_ASR_GPU_MEMORY_UTILIZATION:-0.38}"
SCRIPT="/mnt/d/Projects/airi/services/stt/Qwen3-asr/server.py"

if curl --silent --fail --max-time 2 "http://127.0.0.1:${PORT}/health" | grep --quiet '"streaming":true'; then
  echo "Qwen3-ASR streaming service is already ready on port ${PORT}."
  exit 0
fi

if ss -lnt "sport = :${PORT}" | grep --quiet LISTEN; then
  echo "Port ${PORT} is occupied by a non-streaming service. Stop it before starting Qwen3-ASR streaming." >&2
  exit 1
fi

if [[ ! -x "${VENV}/bin/python3" ]]; then
  echo "Missing Qwen3-ASR virtual environment: ${VENV}" >&2
  exit 1
fi

if [[ ! -f "${SCRIPT}" ]]; then
  echo "Missing Qwen3-ASR bridge: ${SCRIPT}" >&2
  exit 1
fi

export HF_HOME
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

exec "${VENV}/bin/python3" "${SCRIPT}" \
  --model "${MODEL}" \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --chunk-size-sec 1.0 \
  --unfixed-chunk-num 4 \
  --unfixed-token-num 5
