from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_ID = "Qwen/Qwen3-VL-4B-Instruct"
MODEL_REVISION = "ebb281ec70b05090aa6165b016eac8ec08e71b17"
EXPECTED_SHARDS = {
    "model-00001-of-00002.safetensors": {
        "bytes": 4_967_229_296,
        "sha256": "30a01a0556622645a3cce87b655bbbbbc1f170c196099f1b666c93202c3339a9",
    },
    "model-00002-of-00002.safetensors": {
        "bytes": 3_908_490_048,
        "sha256": "046296a2a387efb43b0c997d5833c789604d168834f6e0d3064bf7bb13d002a6",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    cache_dir = Path(
        os.environ.get(
            "HF_HOME",
            "/home/wyb/.cache/airi-models/huggingface",
        )
    )
    snapshot = Path(
        snapshot_download(
            repo_id=MODEL_ID,
            revision=MODEL_REVISION,
            cache_dir=cache_dir,
            allow_patterns=[
                "*.json",
                "*.jinja",
                "*.model",
                "*.safetensors",
                "*.txt",
                "LICENSE*",
                "README.md",
            ],
        )
    )

    evidence: dict[str, object] = {
        "modelId": MODEL_ID,
        "revision": MODEL_REVISION,
        "snapshot": str(snapshot),
        "shards": {},
    }
    shard_evidence: dict[str, object] = {}
    for filename, expected in EXPECTED_SHARDS.items():
        path = snapshot / filename
        actual = {
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        shard_evidence[filename] = actual
        if actual != expected:
            raise RuntimeError(f"model-shard-identity-mismatch:{filename}")
    evidence["shards"] = shard_evidence
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
