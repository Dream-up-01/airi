const TARGET_CHUNK_SAMPLES = 1_600

class QwenCloudPcmProcessor extends AudioWorkletProcessor {
  readonly #buffer = new Int16Array(TARGET_CHUNK_SAMPLES)
  #offset = 0

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel)
      return true
    for (let index = 0; index < channel.length; index++) {
      const sample = Math.max(-1, Math.min(1, channel[index] ?? 0))
      this.#buffer[this.#offset++] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7FFF)
      if (this.#offset === this.#buffer.length) {
        const output = this.#buffer.slice()
        this.port.postMessage(output, [output.buffer])
        this.#offset = 0
      }
    }
    return true
  }
}

registerProcessor('qwen-cloud-pcm-processor', QwenCloudPcmProcessor)
