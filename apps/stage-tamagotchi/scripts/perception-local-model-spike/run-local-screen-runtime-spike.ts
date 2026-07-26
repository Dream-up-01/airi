import process from 'node:process'

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import {
  LOCAL_SCREEN_OLLAMA_MANIFEST_DIGEST,
  LOCAL_SCREEN_OLLAMA_MODEL_TAG,
  LOCAL_SCREEN_SEMANTIC_MODEL_ID,
  LocalOllamaScreenError,
  LocalOllamaScreenRuntime,
} from '@proj-airi/stage-ui/services/perception'

const imagePaths = process.argv.slice(2)
if (imagePaths.length < 2 || imagePaths.length > 4)
  throw new Error('two-to-four-synthetic-jpegs-required')

const jpegFrames = await Promise.all(imagePaths.map(path => readFile(path)))
const gpuSamples: number[] = []
let gpuPollBusy = false
function sampleGpu() {
  if (gpuPollBusy)
    return
  gpuPollBusy = true
  execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], (error, stdout) => {
    gpuPollBusy = false
    if (error)
      return
    const total = stdout.trim().split(/\r?\n/).reduce((sum, value) => sum + (Number(value) || 0), 0)
    gpuSamples.push(total)
  })
}
sampleGpu()
const gpuTimer = setInterval(sampleGpu, 250)

const runtime = new LocalOllamaScreenRuntime({
  generation: 1,
  deviceClass: 'nvidia-8gb',
  requestTimeoutMs: 180_000,
  idleUnloadMs: 0,
})

let sequence = 0
function envelope() {
  const observationId = `spike:observation:${++sequence}`
  return {
    observationId,
    sessionId: 'spike:session:local-screen',
    generation: 1,
    sourceId: 'spike:synthetic-screen',
    observedAt: Date.now(),
    eventId: (index: number) => `${observationId}:event:${index}`,
    adapterId: 'screen:ollama-local',
    runtimeModelId: LOCAL_SCREEN_SEMANTIC_MODEL_ID,
  }
}

try {
  const validation = await runtime.validate()
  const single = await runtime.analyze({
    jpegFrames: [jpegFrames[0]!],
    envelope: envelope(),
  })
  const browser = await runtime.analyze({
    jpegFrames: [jpegFrames[1]!],
    envelope: envelope(),
  })
  const multiple = await runtime.analyze({
    jpegFrames: jpegFrames.slice(0, 2),
    envelope: envelope(),
  })

  const cancellation = new AbortController()
  const cancelledInference = runtime.analyze({
    jpegFrames: [jpegFrames[1]!],
    envelope: envelope(),
    signal: cancellation.signal,
  })
  setTimeout(() => cancellation.abort(), 10)
  let cancellationCode = 'request-completed-before-cancel'
  try {
    await cancelledInference
  }
  catch (error) {
    cancellationCode = error instanceof LocalOllamaScreenError ? error.code : 'unexpected-error'
  }

  await runtime.stop()
  const unloaded = await waitUntilUnloaded()
  clearInterval(gpuTimer)
  await new Promise(resolve => setTimeout(resolve, 300))

  const evidence = {
    model: {
      semanticId: validation.profile.modelId,
      runtimeTag: validation.runtimeModelTag,
      manifestDigest: validation.digest,
      license: validation.license,
      runtimeVersion: validation.runtimeVersion,
      quantizationId: validation.profile.quantizationId,
    },
    single: summarize(single),
    browser: summarize(browser),
    multiple: summarize(multiple),
    cancellationCode,
    unloaded,
    peakGpuMemoryUsedMiB: gpuSamples.length > 0 ? Math.max(...gpuSamples) : 0,
  }
  console.info(JSON.stringify(evidence, null, 2))

  if (validation.digest !== LOCAL_SCREEN_OLLAMA_MANIFEST_DIGEST
    || validation.runtimeModelTag !== LOCAL_SCREEN_OLLAMA_MODEL_TAG
    || cancellationCode !== 'screen-inference-cancelled'
    || !unloaded) {
    process.exitCode = 1
  }
}
finally {
  clearInterval(gpuTimer)
  await runtime.stop()
}

function summarize(result: Awaited<ReturnType<LocalOllamaScreenRuntime['analyze']>>) {
  return {
    totalDurationMs: result.totalDurationMs,
    loadDurationMs: result.loadDurationMs,
    promptTokenCount: result.promptTokenCount,
    outputTokenCount: result.outputTokenCount,
    events: result.events.map(event => ({
      eventType: event.eventType,
      value: event.value,
      confidence: event.confidence,
      sourceKind: event.sourceKind,
      processing: event.provenance.processing,
    })),
  }
}

async function waitUntilUnloaded(): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:11434/api/ps')
      const value = await response.json() as { models?: Array<{ name?: string, model?: string }> }
      const loaded = value.models?.some(model => model.name === LOCAL_SCREEN_OLLAMA_MODEL_TAG || model.model === LOCAL_SCREEN_OLLAMA_MODEL_TAG) ?? false
      if (!loaded)
        return true
    }
    catch {
      return false
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}
