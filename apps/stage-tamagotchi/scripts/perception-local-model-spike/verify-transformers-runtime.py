from __future__ import annotations

import json

import accelerate
import bitsandbytes
import torch
import transformers


def main() -> None:
    if not torch.cuda.is_available():
        raise RuntimeError("cuda-unavailable")

    device = torch.device("cuda:0")
    values = torch.tensor([1.0, 2.0], device=device)
    kernel_result = (values * values).sum().item()
    capability = torch.cuda.get_device_capability(device)

    print(
        json.dumps(
            {
                "torch": torch.__version__,
                "cudaRuntime": torch.version.cuda,
                "cudaAvailable": torch.cuda.is_available(),
                "device": torch.cuda.get_device_name(device),
                "capability": list(capability),
                "kernelResult": kernel_result,
                "bitsandbytes": bitsandbytes.__version__,
                "transformers": transformers.__version__,
                "accelerate": accelerate.__version__,
            },
            separators=(",", ":"),
        )
    )

    if capability != (12, 0) or kernel_result != 5.0:
        raise RuntimeError("blackwell-kernel-self-test-failed")


if __name__ == "__main__":
    main()
