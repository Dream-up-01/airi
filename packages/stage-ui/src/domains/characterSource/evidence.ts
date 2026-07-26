import type { CharacterFact, CharacterSourceAnalysisV1, CharacterSourceDocument, GroundedCharacterValue } from './contracts'

/** Stable reason why an extracted value cannot be grounded in its source. */
export type CharacterEvidenceIssueCode = 'evidence_block_missing' | 'quote_not_found' | 'redacted_evidence' | 'subject_mismatch'

/** Evidence verification failure without copied private source text. */
export interface CharacterEvidenceIssue {
  /** Stable issue category. */
  code: CharacterEvidenceIssueCode
  /** Fact rejected by the verifier. */
  factId: string
  /** Declared evidence blocks, retained as local identifiers only. */
  evidenceBlockIds: string[]
}

/** Deterministic verification result for one extraction analysis. */
export interface CharacterEvidenceVerificationResult {
  /** Analysis with every fact marked verified or rejected. */
  analysis: CharacterSourceAnalysisV1
  /** Rejected evidence references requiring model or user review. */
  issues: CharacterEvidenceIssue[]
}

function normalizeEvidenceText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[“”„‟]/gu, '"')
    .replace(/[‘’‚‛]/gu, '\'')
    .replace(/，/gu, ',')
    .replace(/。/gu, '.')
    .replace(/：/gu, ':')
    .replace(/；/gu, ';')
    .replace(/！/gu, '!')
    .replace(/？/gu, '?')
    .replace(/\s+/gu, ' ')
    .trim()
}

function verifyFact(
  fact: CharacterFact,
  blocksById: ReadonlyMap<string, string>,
  selectedNames: readonly string[],
  otherCandidateNames: readonly string[],
): { fact: CharacterFact, issue?: CharacterEvidenceIssue } {
  if (/\[REDACTED:(?:credential|local-path)\]/u.test(`${fact.value}\n${fact.quote}`)) {
    return {
      fact: { ...fact, evidenceValidation: 'rejected' },
      issue: {
        code: 'redacted_evidence',
        factId: fact.factId,
        evidenceBlockIds: [...fact.evidenceBlockIds],
      },
    }
  }
  const evidenceBlocks = fact.evidenceBlockIds
    .map(blockId => blocksById.get(blockId))
    .filter((text): text is string => text !== undefined)
  if (evidenceBlocks.length !== fact.evidenceBlockIds.length) {
    return {
      fact: { ...fact, evidenceValidation: 'rejected' },
      issue: {
        code: 'evidence_block_missing',
        factId: fact.factId,
        evidenceBlockIds: [...fact.evidenceBlockIds],
      },
    }
  }

  const normalizedQuote = normalizeEvidenceText(fact.quote)
  const quoteFound = normalizedQuote.length > 0
    && evidenceBlocks.some(block => normalizeEvidenceText(block).includes(normalizedQuote))
  if (!quoteFound) {
    return {
      fact: { ...fact, evidenceValidation: 'rejected' },
      issue: {
        code: 'quote_not_found',
        factId: fact.factId,
        evidenceBlockIds: [...fact.evidenceBlockIds],
      },
    }
  }

  const characterOwnedCategories = new Set<CharacterFact['category']>([
    'identity',
    'personality',
    'language-style',
    'background',
    'ability',
  ])
  const normalizedQuoteForSubject = normalizeEvidenceText(fact.quote).toLocaleLowerCase('und')
  const namesInQuote = (names: readonly string[]) => names.some(name => normalizedQuoteForSubject.includes(name))
  // This is deliberately narrow: only reject an obvious attribution to a
  // different discovered character. Pronoun-only evidence remains reviewable.
  if (characterOwnedCategories.has(fact.category)
    && namesInQuote(otherCandidateNames)
    && !namesInQuote(selectedNames)) {
    return {
      fact: { ...fact, evidenceValidation: 'rejected' },
      issue: {
        code: 'subject_mismatch',
        factId: fact.factId,
        evidenceBlockIds: [...fact.evidenceBlockIds],
      },
    }
  }

  return { fact: { ...fact, evidenceValidation: 'verified' } }
}

/**
 * Verifies that every model-provided quote occurs in a declared source block.
 * Only NFKC, whitespace, and common Chinese/ASCII punctuation equivalence are
 * allowed; semantic paraphrases never count as evidence.
 */
export function verifyCharacterSourceAnalysis(
  analysis: CharacterSourceAnalysisV1,
  document: CharacterSourceDocument,
): CharacterEvidenceVerificationResult {
  const blocksById = new Map(document.blocks.map(block => [block.blockId, block.text]))
  const selectedCandidate = analysis.candidates.find(candidate => candidate.candidateId === analysis.selectedCandidateId)
  const normalizeName = (name: string) => normalizeEvidenceText(name).toLocaleLowerCase('und')
  const selectedNames = selectedCandidate
    ? [selectedCandidate.name, ...selectedCandidate.aliases].map(normalizeName)
    : []
  const otherCandidateNames = analysis.candidates
    .filter(candidate => candidate.candidateId !== analysis.selectedCandidateId)
    .flatMap(candidate => [candidate.name, ...candidate.aliases])
    .map(normalizeName)
    .filter(name => name.length >= 2)
  const issues: CharacterEvidenceIssue[] = []
  const facts = analysis.facts.map((fact) => {
    const result = verifyFact(fact, blocksById, selectedNames, otherCandidateNames)
    if (result.issue)
      issues.push(result.issue)
    return result.fact
  })

  return {
    analysis: { ...analysis, facts },
    issues,
  }
}

/**
 * Returns whether one grounded field is eligible for draft compilation.
 * Inferred fields additionally require explicit user confirmation.
 */
export function isGroundedValueAccepted<T>(value: GroundedCharacterValue<T>): boolean {
  if (value.origin === 'user')
    return value.userConfirmed === true
  return value.evidenceValidation === 'verified'
    && value.supportStatus !== 'ambiguous'
    && (value.supportStatus !== 'inferred' || value.userConfirmed)
}
