import type {
  QwenCloudCostAuthorization,
  QwenCloudCostEntry,
  QwenCloudCostSnapshot,
} from '@proj-airi/stage-ui/domains/perception'

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import {
  parseQwenCloudCostEntries,
  QwenCloudCostLedger,
} from '@proj-airi/stage-ui/domains/perception'
import { app } from 'electron'

const FILE_VERSION = 'qwen-cloud-cost-ledger/v1' as const
const MAX_FILE_BYTES = 512 * 1024

interface PersistedCostLedger {
  version: typeof FILE_VERSION
  entries: QwenCloudCostEntry[]
}

export interface QwenCloudCostLedgerPort {
  authorize: (sessionId: string, estimatedAmountMicros: number) => QwenCloudCostAuthorization
  record: (entry: QwenCloudCostEntry) => QwenCloudCostAuthorization
  recordIncurred: (entry: QwenCloudCostEntry) => QwenCloudCostAuthorization
  snapshot: (sessionId: string) => QwenCloudCostSnapshot
  isAvailable?: () => boolean
}

/** Main-process, metadata-only cost ledger used to enforce daily/monthly budgets across restarts. */
export class QwenCloudCostLedgerStore implements QwenCloudCostLedgerPort {
  readonly #filePath: string
  readonly #now: () => number
  #ledger: QwenCloudCostLedger
  #available = true

  constructor(options: { filePath?: string, now?: () => number } = {}) {
    this.#filePath = options.filePath ?? join(app.getPath('userData'), 'perception-qwen-cost-ledger-v1.json')
    this.#now = options.now ?? Date.now
    this.#ledger = new QwenCloudCostLedger({ now: this.#now })
    this.#load()
  }

  isAvailable(): boolean {
    return this.#available
  }

  authorize(sessionId: string, estimatedAmountMicros: number): QwenCloudCostAuthorization {
    this.#assertAvailable()
    return this.#ledger.authorize(sessionId, estimatedAmountMicros)
  }

  record(entry: QwenCloudCostEntry): QwenCloudCostAuthorization {
    this.#assertAvailable()
    const candidate = new QwenCloudCostLedger({
      now: this.#now,
      restoredEntries: this.#ledger.exportEntries(),
    })
    const result = candidate.record(entry)
    if (!result.allowed)
      return result
    const entries = retainCurrentChinaMonth(candidate.exportEntries(), this.#now())
    try {
      this.#persist(entries)
      this.#ledger = new QwenCloudCostLedger({ now: this.#now, restoredEntries: entries })
      return { allowed: true, snapshot: this.#ledger.snapshot(entry.sessionId) }
    }
    catch {
      this.#available = false
      throw new Error('qwen-cloud-cost-ledger-unavailable')
    }
  }

  recordIncurred(entry: QwenCloudCostEntry): QwenCloudCostAuthorization {
    this.#assertAvailable()
    const candidate = new QwenCloudCostLedger({
      now: this.#now,
      restoredEntries: this.#ledger.exportEntries(),
    })
    const result = candidate.recordIncurred(entry)
    const entries = retainCurrentChinaMonth(candidate.exportEntries(), this.#now())
    try {
      this.#persist(entries)
      this.#ledger = new QwenCloudCostLedger({ now: this.#now, restoredEntries: entries })
      return { ...result, snapshot: this.#ledger.snapshot(entry.sessionId) }
    }
    catch {
      this.#available = false
      throw new Error('qwen-cloud-cost-ledger-unavailable')
    }
  }

  snapshot(sessionId: string): QwenCloudCostSnapshot {
    return this.#ledger.snapshot(sessionId)
  }

  #load(): void {
    if (!existsSync(this.#filePath))
      return
    try {
      if (statSync(this.#filePath).size > MAX_FILE_BYTES)
        throw new Error('cost-ledger-too-large')
      const parsed = JSON.parse(readFileSync(this.#filePath, 'utf8')) as unknown
      if (!isPersistedLedger(parsed))
        throw new Error('cost-ledger-invalid')
      const entries = retainCurrentChinaMonth(parsed.entries, this.#now())
      this.#ledger = new QwenCloudCostLedger({ now: this.#now, restoredEntries: entries })
      if (entries.length !== parsed.entries.length)
        this.#persist(entries)
    }
    catch {
      this.#available = false
      this.#ledger = new QwenCloudCostLedger({ now: this.#now })
    }
  }

  #persist(entries: QwenCloudCostEntry[]): void {
    const directory = dirname(this.#filePath)
    mkdirSync(directory, { recursive: true })
    const temporaryPath = `${this.#filePath}.${randomUUID()}.tmp`
    try {
      const payload: PersistedCostLedger = { version: FILE_VERSION, entries }
      writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
      renameSync(temporaryPath, this.#filePath)
    }
    finally {
      rmSync(temporaryPath, { force: true })
    }
  }

  #assertAvailable(): void {
    if (!this.#available)
      throw new Error('qwen-cloud-cost-ledger-unavailable')
  }
}

function isPersistedLedger(input: unknown): input is PersistedCostLedger {
  if (!isRecord(input) || !hasExactKeys(input, ['entries', 'version']) || input.version !== FILE_VERSION)
    return false
  return parseQwenCloudCostEntries(input.entries).ok
}

function retainCurrentChinaMonth(entries: QwenCloudCostEntry[], now: number): QwenCloudCostEntry[] {
  const currentMonth = chinaMonth(now)
  return entries.filter(entry => chinaMonth(entry.incurredAt) === currentMonth).map(entry => ({ ...entry }))
}

function chinaMonth(timestamp: number): string {
  return new Date(timestamp + 8 * 60 * 60 * 1_000).toISOString().slice(0, 7)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input) && Object.getPrototypeOf(input) === Object.prototype
}

function hasExactKeys(input: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(input).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}
