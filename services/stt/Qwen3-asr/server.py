from __future__ import annotations

import argparse
import atexit
import os
import signal
import threading
import time
import uuid
from dataclasses import dataclass

import numpy as np
from flask import Flask, Response, jsonify, request
from qwen_asr import Qwen3ASRModel


@dataclass
class Session:
    state: object
    created_at: float
    last_seen: float


app = Flask(__name__)
sessions: dict[str, Session] = {}
sessions_lock = threading.RLock()
inference_lock = threading.RLock()
asr = None

MODEL_ID = "Qwen/Qwen3-ASR-0.6B"
CHUNK_SIZE_SEC = 1.0
UNFIXED_CHUNK_NUM = 4
UNFIXED_TOKEN_NUM = 5
SESSION_TTL_SEC = 10 * 60
PID_FILE = "/tmp/airi-qwen3-asr.pid"
LANGUAGE_ALIASES = {
    "zh": "Chinese",
    "en": "English",
    "yue": "Cantonese",
    "ja": "Japanese",
    "ko": "Korean",
}


def cors(response: Response) -> Response:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Cache-Control"] = "no-store"
    return response


app.after_request(cors)


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def api_options(_path: str):
    return Response(status=204)


def gc_sessions() -> None:
    now = time.time()
    with sessions_lock:
        expired = [session_id for session_id, session in sessions.items() if now - session.last_seen > SESSION_TTL_SEC]
        for session_id in expired:
            sessions.pop(session_id, None)


def get_session(session_id: str) -> Session | None:
    gc_sessions()
    with sessions_lock:
        session = sessions.get(session_id)
        if session:
            session.last_seen = time.time()
        return session


@app.get("/health")
def health():
    with sessions_lock:
        active_sessions = len(sessions)
    return jsonify(
        {
            "ok": asr is not None,
            "streaming": True,
            "model": MODEL_ID,
            "sample_rate": 16000,
            "input_format": "float32le",
            "active_sessions": active_sessions,
        }
    )


@app.post("/api/start")
def api_start():
    payload = request.get_json(silent=True) or {}
    language = str(payload.get("language") or "").strip() or None
    if language:
        language = LANGUAGE_ALIASES.get(language.lower(), language)
    context = str(payload.get("context") or "").strip()

    try:
        state = asr.init_streaming_state(
            context=context,
            language=language,
            unfixed_chunk_num=UNFIXED_CHUNK_NUM,
            unfixed_token_num=UNFIXED_TOKEN_NUM,
            chunk_size_sec=CHUNK_SIZE_SEC,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    session_id = uuid.uuid4().hex
    now = time.time()
    with sessions_lock:
        sessions[session_id] = Session(state=state, created_at=now, last_seen=now)
    return jsonify({"session_id": session_id})


@app.post("/api/chunk")
def api_chunk():
    session_id = request.args.get("session_id", "")
    session = get_session(session_id)
    if not session:
        return jsonify({"error": "invalid session_id"}), 404
    if request.mimetype != "application/octet-stream":
        return jsonify({"error": "expected application/octet-stream"}), 415

    raw = request.get_data(cache=False)
    if len(raw) % 4 != 0:
        return jsonify({"error": "float32 byte length must be divisible by four"}), 400

    pcm = np.frombuffer(raw, dtype="<f4").reshape(-1)
    with inference_lock:
        asr.streaming_transcribe(pcm, session.state)

    return jsonify(
        {
            "language": getattr(session.state, "language", "") or "",
            "text": getattr(session.state, "text", "") or "",
        }
    )


@app.post("/api/finish")
def api_finish():
    session_id = request.args.get("session_id", "")
    session = get_session(session_id)
    if not session:
        return jsonify({"error": "invalid session_id"}), 404

    try:
        with inference_lock:
            asr.finish_streaming_transcribe(session.state)
        return jsonify(
            {
                "language": getattr(session.state, "language", "") or "",
                "text": getattr(session.state, "text", "") or "",
            }
        )
    finally:
        with sessions_lock:
            sessions.pop(session_id, None)


@app.post("/api/cancel")
def api_cancel():
    session_id = request.args.get("session_id", "")
    with sessions_lock:
        removed = sessions.pop(session_id, None)
    return jsonify({"cancelled": removed is not None})


def remove_pid_file() -> None:
    try:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
    except OSError:
        pass


def handle_shutdown(_signum, _frame) -> None:
    remove_pid_file()
    raise SystemExit(0)


def parse_args():
    parser = argparse.ArgumentParser(description="AIRI Qwen3-ASR streaming bridge")
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--gpu-memory-utilization", type=float, default=0.38)
    parser.add_argument("--chunk-size-sec", type=float, default=1.0)
    parser.add_argument("--unfixed-chunk-num", type=int, default=4)
    parser.add_argument("--unfixed-token-num", type=int, default=5)
    parser.add_argument("--pid-file", default=PID_FILE)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    global asr
    global MODEL_ID
    global CHUNK_SIZE_SEC
    global UNFIXED_CHUNK_NUM
    global UNFIXED_TOKEN_NUM
    global PID_FILE

    MODEL_ID = args.model
    CHUNK_SIZE_SEC = args.chunk_size_sec
    UNFIXED_CHUNK_NUM = args.unfixed_chunk_num
    UNFIXED_TOKEN_NUM = args.unfixed_token_num
    PID_FILE = args.pid_file

    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
    with open(PID_FILE, "w", encoding="utf-8") as pid_file:
        pid_file.write(str(os.getpid()))

    atexit.register(remove_pid_file)
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    asr = Qwen3ASRModel.LLM(
        model=MODEL_ID,
        gpu_memory_utilization=args.gpu_memory_utilization,
        max_model_len=4096,
        max_num_seqs=1,
        max_new_tokens=64,
        # AIRI sends one microphone stream per ASR request. vLLM otherwise
        # profiles the multimodal encoder with ten maximum-sized audio items,
        # reserving several unnecessary GiB and starving local GPT-SoVITS.
        limit_mm_per_prompt={"audio": 1},
    )

    app.run(host=args.host, port=args.port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
