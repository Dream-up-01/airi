export type CloudPerceptionFailure
  = | 'provider-unavailable'
    | 'network-failed'
    | 'rate-limited'
    | 'cost-guard'
    | 'permission-revoked'
    | 'invalid-response'

export type CloudFailureDecision
  = | { retry: true, attempt: number, delayMs: number }
    | { retry: false, attempt: number, terminalReason: CloudPerceptionFailure }

/** Bounded retry policy only; it never selects another provider/model or local fallback. */
export class CloudPerceptionFailurePolicy {
  readonly #maxAttempts: number
  readonly #backoffMs: readonly number[]
  #attempt = 0
  #terminal?: CloudPerceptionFailure

  constructor(options: { maxAttempts?: number, backoffMs?: readonly number[] } = {}) {
    this.#maxAttempts = options.maxAttempts ?? 3
    this.#backoffMs = options.backoffMs ?? [1_000, 2_000, 4_000]
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts < 0 || this.#maxAttempts > 5 || this.#backoffMs.length < this.#maxAttempts)
      throw new Error('cloud_failure_policy_invalid')
  }

  record(failure: CloudPerceptionFailure): CloudFailureDecision {
    if (this.#terminal)
      return { retry: false, attempt: this.#attempt, terminalReason: this.#terminal }
    if (['cost-guard', 'permission-revoked', 'invalid-response'].includes(failure)) {
      this.#terminal = failure
      return { retry: false, attempt: this.#attempt, terminalReason: failure }
    }
    if (this.#attempt >= this.#maxAttempts) {
      this.#terminal = failure
      return { retry: false, attempt: this.#attempt, terminalReason: failure }
    }

    this.#attempt += 1
    return { retry: true, attempt: this.#attempt, delayMs: this.#backoffMs[this.#attempt - 1]! }
  }

  resetAfterSuccess(): void {
    this.#attempt = 0
    this.#terminal = undefined
  }
}
