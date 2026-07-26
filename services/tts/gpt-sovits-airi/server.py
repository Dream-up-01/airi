"""A private, loopback-only OpenAI-shaped facade for the bundled GPT-SoVITS.

The AIRI renderer only sees a stable model and voice id. Reference-audio paths,
reference text, and weight paths stay in this local process and are never
returned in HTTP errors, telemetry, or card data.
"""

import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


SERVICE_ROOT = Path(__file__).resolve().parent
TTS_ROOT = SERVICE_ROOT.parent
CONFIG_PATH = SERVICE_ROOT / "bridge-config.json"
NATIVE_BASE_URL = os.getenv("AIRI_GPT_SOVITS_NATIVE_URL", "http://127.0.0.1:9880").rstrip("/")
MAX_INPUT_CHARACTERS = 3000
AIRI_DEVELOPMENT_ORIGIN_REGEX = r"^http://(?:localhost|127\.0\.0\.1):\d+$"


@dataclass(frozen=True)
class BridgeConfig:
    model_id: str
    voice_id: str
    reference_audio: Path
    reference_text: str
    gpt_weights: Path
    sovits_weights: Path


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=MAX_INPUT_CHARACTERS)
    model: str
    voice: str
    response_format: Optional[str] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)


def _resolve_local_path(value: Any, field_name: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"invalid {field_name} configuration")

    candidate = (TTS_ROOT / value).resolve()
    try:
        candidate.relative_to(TTS_ROOT)
    except ValueError as error:
        raise RuntimeError(f"invalid {field_name} configuration") from error

    if not candidate.is_file():
        raise RuntimeError(f"missing {field_name} configuration")
    return candidate


def load_config() -> BridgeConfig:
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("invalid bridge configuration") from error

    model_id = raw.get("modelId")
    voice_id = raw.get("voiceId")
    reference_text = raw.get("referenceText")
    if not isinstance(model_id, str) or not model_id.strip():
        raise RuntimeError("invalid model configuration")
    if not isinstance(voice_id, str) or not voice_id.strip():
        raise RuntimeError("invalid voice configuration")
    if not isinstance(reference_text, str) or not reference_text.strip():
        raise RuntimeError("invalid reference text configuration")

    return BridgeConfig(
        model_id=model_id,
        voice_id=voice_id,
        reference_audio=_resolve_local_path(raw.get("referenceAudio"), "reference audio"),
        reference_text=reference_text,
        gpt_weights=_resolve_local_path(raw.get("gptWeights"), "GPT weights"),
        sovits_weights=_resolve_local_path(raw.get("sovitsWeights"), "SoVITS weights"),
    )


CONFIG = load_config()
native_ready = False
native_lock = asyncio.Lock()
synthesis_lock = asyncio.Lock()


def _native_get(path: str, query: Dict[str, str]) -> None:
    url = f"{NATIVE_BASE_URL}{path}?{urlencode(query)}"
    with urlopen(Request(url, method="GET"), timeout=90) as response:
        if response.status != 200:
            raise RuntimeError("native GPT-SoVITS rejected configuration")


def _native_tts(payload: Dict[str, Any]) -> Tuple[bytes, str]:
    request = Request(
        f"{NATIVE_BASE_URL}/tts",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=180) as response:
        if response.status != 200:
            raise RuntimeError("native GPT-SoVITS synthesis failed")
        media_type = response.headers.get_content_type() or "audio/wav"
        return response.read(), media_type


async def ensure_native_ready() -> bool:
    """Loads the requested weights once, without exposing local paths upstream."""
    global native_ready
    if native_ready:
        return True

    async with native_lock:
        if native_ready:
            return True
        try:
            await asyncio.to_thread(_native_get, "/set_gpt_weights", {"weights_path": str(CONFIG.gpt_weights)})
            await asyncio.to_thread(_native_get, "/set_sovits_weights", {"weights_path": str(CONFIG.sovits_weights)})
        except (HTTPError, URLError, OSError, RuntimeError):
            return False

        native_ready = True
        return True


app = FastAPI(title="AIRI GPT-SoVITS Local Bridge", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["app://-"],
    allow_origin_regex=AIRI_DEVELOPMENT_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    # The OpenAI-compatible client always attaches an Authorization header,
    # even for this credential-free loopback provider. Permit that header so
    # Chromium's preflight reaches the actual local synthesis endpoint.
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health")
async def health() -> Dict[str, bool]:
    ready = await ensure_native_ready()
    return {"ok": ready, "local": True}


@app.get("/v1/models")
async def list_models() -> Dict[str, Any]:
    return {"data": [{"id": CONFIG.model_id, "object": "model", "owned_by": "local"}]}


@app.post("/v1/audio/speech")
async def synthesize(request: SpeechRequest) -> Response:
    if request.model != CONFIG.model_id or request.voice != CONFIG.voice_id:
        raise HTTPException(status_code=400, detail="unsupported local speech profile")
    if not await ensure_native_ready():
        raise HTTPException(status_code=503, detail="local_tts_unavailable")

    text = request.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty speech input")

    payload = {
        "text": text,
        "text_lang": "zh",
        "ref_audio_path": str(CONFIG.reference_audio),
        "prompt_text": CONFIG.reference_text,
        "prompt_lang": "zh",
        "text_split_method": "cut5",
        "batch_size": 1,
        "media_type": "wav",
        "streaming_mode": 0,
        "speed_factor": request.speed if request.speed is not None else 1.0,
    }

    # The bundled model is already internally batched. Serializing bridge
    # requests avoids concurrent weight access and GPU spikes when the LLM
    # produces several short TTS chunks in quick succession.
    async with synthesis_lock:
        try:
            audio, media_type = await asyncio.to_thread(_native_tts, payload)
        except (HTTPError, URLError, OSError, RuntimeError):
            raise HTTPException(status_code=502, detail="local_tts_generation_failed") from None

    if not audio:
        raise HTTPException(status_code=502, detail="local_tts_generation_failed")
    return Response(content=audio, media_type=media_type)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=9888, log_level="warning")
