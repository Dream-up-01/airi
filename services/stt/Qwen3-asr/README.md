# Qwen3-ASR streaming service for AIRI

This bridge runs `Qwen/Qwen3-ASR-0.6B` inside the local Ubuntu WSL2 instance and exposes a loopback-friendly streaming protocol:

- `GET /health`
- `POST /api/start`
- `POST /api/chunk?session_id=...` with 16 kHz mono Float32LE audio
- `POST /api/finish?session_id=...`
- `POST /api/cancel?session_id=...`

Start and stop from Windows with `start-qwen3-asr.cmd` and `stop-qwen3-asr.cmd`.

The start script reuses `/home/wyb/.venvs/qwen3-asr` and the model cache under `/home/wyb/models/huggingface`. It runs offline and does not copy model weights into the Windows repository.
