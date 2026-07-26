#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/airi-qwen3-asr.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "Qwen3-ASR streaming service is not running under AIRI management."
  exit 0
fi

PID="$(cat "${PID_FILE}")"
if [[ ! "${PID}" =~ ^[0-9]+$ ]]; then
  echo "Invalid PID file: ${PID_FILE}" >&2
  exit 1
fi

if kill -0 "${PID}" 2>/dev/null; then
  pkill -TERM -P "${PID}" 2>/dev/null || true
  kill -TERM "${PID}" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! kill -0 "${PID}" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
fi

rm -f "${PID_FILE}"
echo "Qwen3-ASR streaming service stopped."
