import type { Card } from '../define'

/** Stable reason why a card cannot be distributed safely. */
export type CardExportPrivacyIssueCode
  = | 'credential_field'
    | 'credential_value'
    | 'local_path'
    | 'non_serializable_value'
    | 'source_metadata'
    | 'unconfirmed_inference'

/** Path-only export issue that never copies the sensitive value. */
export interface CardExportPrivacyIssue {
  /** Machine-readable reason suitable for localization. */
  code: CardExportPrivacyIssueCode
  /** Dot-separated location in the neutral Card object. */
  path: string
}

/** Error thrown before JSON or PNG export could expose private card data. */
export class CardExportPrivacyException extends Error {
  /** All detected issues, ordered by deterministic object traversal. */
  readonly issues: CardExportPrivacyIssue[]

  constructor(issues: CardExportPrivacyIssue[]) {
    super('Character card export contains private or temporary data.')
    this.name = 'CardExportPrivacyException'
    this.issues = issues
  }
}

const credentialValuePatterns = [
  /\bsk-[\w-]{16,}\b/iu,
  /\bgh[pousr]_[a-z0-9]{20,}\b/iu,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\bBearer\s+[\w.~+/=-]{16,}\b/iu,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/u,
] as const

const localPathPatterns = [
  /\b[A-Z]:\\(?:Users|Documents and Settings)\\[^\s<>:"|?*]+/iu,
  /\/(?:Users|home)\/[^\s/]+(?:\/\S+)*/u,
] as const

function keyIssue(key: string): CardExportPrivacyIssueCode | undefined {
  if (/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|provider[_-]?secret|secret)$/iu.test(key))
    return 'credential_field'
  if (/^(?:document|rawDocument|source|content)[_-]?(?:hash|digest)$/iu.test(key) || /^(?:temporary|temp)?[_-]?job[_-]?id$/iu.test(key))
    return 'source_metadata'
  if (/^(?:unconfirmed|pending)[_-]?(?:inference|inferences|inferredFacts)$/iu.test(key))
    return 'unconfirmed_inference'
  return undefined
}

/**
 * Scans the complete neutral card before a distributable export is built.
 * The result contains paths and categories only, never matching values.
 */
export function scanCardExportPrivacy(card: Card): CardExportPrivacyIssue[] {
  const issues: CardExportPrivacyIssue[] = []
  const pending: Array<{ path: string, value: unknown }> = [{ path: '$', value: card }]
  const visited = new WeakSet<object>()

  while (pending.length > 0) {
    const current = pending.pop()!
    if (typeof current.value === 'string') {
      const text = current.value
      if (credentialValuePatterns.some(pattern => pattern.test(text)))
        issues.push({ code: 'credential_value', path: current.path })
      if (localPathPatterns.some(pattern => pattern.test(text)))
        issues.push({ code: 'local_path', path: current.path })
      continue
    }
    if (current.value === null || typeof current.value === 'boolean' || (typeof current.value === 'number' && Number.isFinite(current.value)))
      continue
    if (typeof current.value !== 'object') {
      issues.push({ code: 'non_serializable_value', path: current.path })
      continue
    }
    if (visited.has(current.value)) {
      issues.push({ code: 'non_serializable_value', path: current.path })
      continue
    }
    visited.add(current.value)

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index--)
        pending.push({ path: `${current.path}.${index}`, value: current.value[index] })
      continue
    }

    const record = current.value as Record<string, unknown>
    const keys = Object.keys(record)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!
      const issue = keyIssue(key)
      if (issue)
        issues.push({ code: issue, path: `${current.path}.${key}` })
      // JSON object properties with undefined values are omitted by the
      // exporter. They are not distributable data and therefore not a leak.
      else if (record[key] !== undefined)
        pending.push({ path: `${current.path}.${key}`, value: record[key] })
    }
  }

  return issues
}

/** Prevents JSON and PNG exporters from serializing private or temporary data. */
export function assertCardExportSafe(card: Card): void {
  const issues = scanCardExportPrivacy(card)
  if (issues.length > 0)
    throw new CardExportPrivacyException(issues)
}
