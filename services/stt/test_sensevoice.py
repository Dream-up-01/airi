from pathlib import Path

import torch
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess


BASE_DIR = Path(__file__).resolve().parent
AUDIO_PATH = BASE_DIR / "samples" / "test.wav"


def main() -> None:
    if not AUDIO_PATH.exists():
        raise FileNotFoundError(
            f"没有找到测试音频：{AUDIO_PATH}\n"
            "请先把一个 5~15 秒的中文 wav 音频放到 samples/test.wav"
        )

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    print(f"当前设备：{device}")

    print("正在加载 SenseVoice-Small，第一次运行会下载模型，可能较慢...")
    model = AutoModel(
        model="iic/SenseVoiceSmall",
        vad_model="fsmn-vad",
        vad_kwargs={"max_single_segment_time": 30000},
        device=device,
    )

    print("模型加载完成，开始识别...")
    result = model.generate(
        input=str(AUDIO_PATH),
        cache={},
        language="auto",
        use_itn=True,
        batch_size_s=60,
        merge_vad=True,
        merge_length_s=15,
    )

    raw_text = result[0]["text"]
    clean_text = rich_transcription_postprocess(raw_text)

    print("\n原始输出：")
    print(raw_text)

    print("\n清理后文本：")
    print(clean_text)


if __name__ == "__main__":
    main()