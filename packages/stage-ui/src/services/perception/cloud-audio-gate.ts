import type { VoicePlaybackEchoGateState } from '../../domains/voiceConversation/echo-gate'
import type { PerceptionPcmAudioChunk } from './audio-fanout'

import { isVoicePlaybackEchoBlocked } from '../../domains/voiceConversation/echo-gate'

export function createCloudPerceptionAudioEchoGate(
  getState: () => VoicePlaybackEchoGateState,
  now: () => number = () => Date.now(),
): (chunk: PerceptionPcmAudioChunk) => boolean {
  return () => !isVoicePlaybackEchoBlocked(getState(), now())
}
