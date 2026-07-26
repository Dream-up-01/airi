# AIRI local Qwen3-VL Transformers service

M3-only loopback worker for `Qwen/Qwen3-VL-4B-Instruct`. It loads the fixed
revision with bitsandbytes NF4, accepts 1–4 transient 1280×720 JPEG frames,
returns only strict bounded objective JSON, and exits on stop or idle timeout so
the CUDA process boundary releases all model resources.

The service is launched lazily by the Desktop main-process manager with a fresh
memory-only `AIRI_PERCEPTION_TOKEN`; the renderer reaches it only through the
directed Eventa gateway and never receives that token. It does not persist frames, prompts, model
output, tokens or local paths, and it intentionally has no CORS, chat, TTS,
tool, memory or character dependencies.

Runtime packages and model weights live outside the repository under the WSL
user profile. They are created only after the user approves the M3 runtime
decision gate.
