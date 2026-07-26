import process from 'node:process'

import { readFile } from 'node:fs/promises'

import {
  LOCAL_SCREEN_SEMANTIC_MODEL_ID,
  LocalTransformersScreenError,
  LocalTransformersScreenRuntime,
} from '@proj-airi/stage-ui/services/perception'

const [codePath, browserPath] = process.argv.slice(2)
const token = process.env.AIRI_PERCEPTION_TOKEN
if (!codePath || !browserPath)
  throw new Error('two-synthetic-jpegs-required')
if (!token)
  throw new Error('memory-only-runtime-token-required')

const [code, browser] = await Promise.all([readFile(codePath), readFile(browserPath)])
const runtime = new LocalTransformersScreenRuntime({
  token,
  sessionId: 'spike:session:transformers-screen',
  generation: 1,
  deviceClass: 'nvidia-8gb',
  validationTimeoutMs: 90_000,
  requestTimeoutMs: 90_000,
})

let sequence = 0
function envelope() {
  const observationId = `spike:transformers:${++sequence}`
  return {
    observationId,
    sessionId: 'spike:session:transformers-screen',
    generation: 1,
    sourceId: 'spike:synthetic-screen',
    observedAt: Date.now(),
    eventId: (index: number) => `${observationId}:event:${index}`,
    adapterId: 'screen:transformers-local',
    runtimeModelId: LOCAL_SCREEN_SEMANTIC_MODEL_ID,
  }
}

function activity(result: Awaited<ReturnType<LocalTransformersScreenRuntime['analyze']>>): string {
  const value = result.events.find(event => event.eventType === 'screen.activity.observed')?.value
  return value?.kind === 'enum' ? value.value : 'missing'
}

try {
  const validation = await runtime.validate()
  const cases = []
  for (const testCase of [
    { name: 'single-code', frames: [code], expected: 'code' },
    { name: 'single-browser', frames: [browser], expected: 'browser' },
    { name: 'multi-code-browser', frames: [code, browser], expected: 'browser' },
    { name: 'multi-browser-code', frames: [browser, code], expected: 'code' },
  ]) {
    const result = await runtime.analyze({ jpegFrames: testCase.frames, envelope: envelope() })
    cases.push({
      name: testCase.name,
      expected: testCase.expected,
      actual: activity(result),
      durationMs: result.totalDurationMs,
      outputTokenCount: result.outputTokenCount,
    })
  }

  const cancellation = new AbortController()
  const pending = runtime.analyze({
    jpegFrames: [browser],
    envelope: envelope(),
    signal: cancellation.signal,
  })
  setTimeout(() => cancellation.abort(), 100)
  let cancellationCode = 'request-completed-before-cancel'
  try {
    await pending
  }
  catch (error) {
    cancellationCode = error instanceof LocalTransformersScreenError ? error.code : 'unexpected-error'
  }
  await new Promise(resolve => setTimeout(resolve, 2_000))

  const evidence = {
    profile: {
      modelId: validation.profile.modelId,
      runtimeKind: validation.profile.runtimeKind,
      state: validation.profile.state,
      revision: validation.profile.revision,
      quantizationId: validation.profile.quantizationId,
      capabilities: validation.profile.capabilities,
      loadDurationMs: validation.loadDurationMs,
    },
    cases,
    cancellationCode,
  }
  console.info(JSON.stringify(evidence, null, 2))
  if (cases.some(testCase => testCase.actual !== testCase.expected)
    || cancellationCode !== 'screen-inference-cancelled') {
    process.exitCode = 1
  }
}
finally {
  await runtime.stop()
}
