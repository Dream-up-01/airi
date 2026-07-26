import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { QWEN_CLOUD_PRICE_PROFILE_ID, QWEN_FLASH_REALTIME_MODEL_ID } from '@proj-airi/stage-ui/domains/perception'
import { afterEach, describe, expect, it } from 'vitest'

import { QwenCloudCostLedgerStore } from './qwen-cloud-cost-ledger-store'

const roots: string[] = []
const now = Date.UTC(2026, 6, 18, 12)

afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

describe('qwenCloudCostLedgerStore', () => {
  it('restores metadata-only spend across process restarts', () => {
    const filePath = temporaryFile()
    const first = new QwenCloudCostLedgerStore({ filePath, now: () => now })
    expect(first.record(entry('session:first', 1_250_000)).allowed).toBe(true)

    const second = new QwenCloudCostLedgerStore({ filePath, now: () => now })
    expect(second.isAvailable()).toBe(true)
    expect(second.snapshot('session:first').sessionSpent).toBe(1.25)
    expect(second.snapshot('session:other').daySpent).toBe(1.25)

    const serialized = readFileSync(filePath, 'utf8')
    expect(serialized).not.toContain('completedText')
    expect(serialized).not.toContain('pcm')
    expect(serialized).not.toContain('jpeg')
  })

  it('fails closed when the persisted ledger is malformed', () => {
    const filePath = temporaryFile()
    writeFileSync(filePath, JSON.stringify({ version: 'qwen-cloud-cost-ledger/v1', entries: [{ amountMicros: -1 }] }))

    const store = new QwenCloudCostLedgerStore({ filePath, now: () => now })
    expect(store.isAvailable()).toBe(false)
    expect(() => store.authorize('session:test', 1)).toThrow('qwen-cloud-cost-ledger-unavailable')
  })

  it('persists an already-incurred overrun and blocks later calls', () => {
    const filePath = temporaryFile()
    const first = new QwenCloudCostLedgerStore({ filePath, now: () => now })
    first.record(entry('session:crossing', 4_900_000))
    expect(first.recordIncurred(entry('session:crossing', 200_000))).toMatchObject({ allowed: false, boundary: 'session' })

    const restored = new QwenCloudCostLedgerStore({ filePath, now: () => now })
    expect(restored.snapshot('session:crossing').sessionSpent).toBe(5.1)
    expect(restored.authorize('session:crossing', 1)).toMatchObject({ allowed: false, boundary: 'session' })
  })
})

function temporaryFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'airi-qwen-cost-'))
  roots.push(root)
  return join(root, 'ledger.json')
}

function entry(sessionId: string, amountMicros: number) {
  return {
    sessionId,
    modelId: QWEN_FLASH_REALTIME_MODEL_ID,
    incurredAt: now,
    amountMicros,
    priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
  }
}
