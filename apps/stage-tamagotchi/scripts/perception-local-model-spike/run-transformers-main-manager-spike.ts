import process from 'node:process'

import { readFile } from 'node:fs/promises'

import { createLocalTransformersScreenManager } from '../../src/main/services/airi/perception/local-transformers-screen'
import {
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_MODEL_ID,
  LOCAL_SCREEN_PROFILE_ID,
} from '../../src/shared/eventa/perception-local-screen'

const [codePath, browserPath] = process.argv.slice(2)
if (!codePath || !browserPath)
  throw new Error('two-synthetic-jpegs-required')

const [code, browser] = await Promise.all([readFile(codePath), readFile(browserPath)])
const sessionId = 'spike:desktop-main-manager'
const generation = 1
const manager = createLocalTransformersScreenManager({ projectRoot: process.cwd() })

function envelope(observationId: string) {
  return {
    observationId,
    sessionId,
    generation,
    sourceId: 'spike:synthetic-screen',
    observedAt: Date.now(),
    eventId: (index: number) => `${observationId}:e${index}`,
    adapterId: 'screen:transformers-local',
    runtimeModelId: LOCAL_SCREEN_MODEL_ID,
    runtimeProviderId: 'transformers-service' as const,
  }
}

try {
  const status = await manager.validate({
    contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
    sessionId,
    generation,
    consentGrantId: 'grant:spike-screen-local',
    profileId: LOCAL_SCREEN_PROFILE_ID,
  })
  const result = await manager.analyze({
    jpegFrames: [code, browser],
    envelope: envelope('spike:desktop-main-manager:1'),
  })
  const activity = result.events.find(event => event.eventType === 'screen.activity.observed')
  const actual = activity?.value.kind === 'enum' ? activity.value.value : 'missing'
  console.info(JSON.stringify({
    state: status.state,
    modelId: status.modelId,
    revision: status.revision,
    quantizationId: status.quantizationId,
    capabilities: status.capabilities,
    loadDurationMs: status.loadDurationMs,
    expected: 'browser',
    actual,
    providerId: activity?.provenance.providerId,
    adapterId: activity?.provenance.adapterId,
    durationMs: result.totalDurationMs,
  }, null, 2))
  if (status.state !== 'ready'
    || actual !== 'browser'
    || activity?.provenance.providerId !== 'transformers-service'
    || activity.provenance.adapterId !== 'screen:transformers-local') {
    process.exitCode = 1
  }
}
finally {
  await manager.stop({
    contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
    sessionId,
    generation,
    reason: 'user-stop',
  })
}
