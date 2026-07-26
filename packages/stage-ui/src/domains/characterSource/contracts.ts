import type { InferOutput } from 'valibot'

import {
  array,
  boolean,
  integer,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  picklist,
  pipe,
  regex,
  strictObject,
  string,
  union,
} from 'valibot'

const identifier = pipe(string(), minLength(1), maxLength(160), regex(/^[a-z0-9][\w.:-]*$/iu))
const shortText = pipe(string(), minLength(1), maxLength(320))
const sourceText = pipe(string(), minLength(1), maxLength(32_000))
const editableSourceText = pipe(string(), maxLength(32_000))
const sha256Digest = pipe(string(), regex(/^[a-f0-9]{64}$/u))
const evidenceIds = pipe(array(identifier), minLength(1), maxLength(64))

/** Format hint inferred by the bounded platform file adapter. */
export const CharacterSourceFormatSchema = picklist(['docx', 'txt', 'md', 'json', 'yaml', 'plain-text'])

/** One ordered source block retained as the evidence address space. */
export const CharacterSourceBlockSchema = strictObject({
  blockId: identifier,
  order: pipe(number(), integer(), minValue(0)),
  kind: picklist(['heading', 'list-item', 'dialogue', 'key-value', 'table-row', 'paragraph', 'unclassified']),
  text: sourceText,
  sourceStart: pipe(number(), integer(), minValue(0)),
  sourceEnd: pipe(number(), integer(), minValue(0)),
  structurePath: optional(pipe(string(), minLength(1), maxLength(512))),
})

/** Versioned, normalized document passed to extraction providers. */
export const CharacterSourceDocumentSchema = strictObject({
  schemaVersion: literal(1),
  documentId: identifier,
  displayName: pipe(string(), minLength(1), maxLength(160)),
  contentHash: sha256Digest,
  format: CharacterSourceFormatSchema,
  languageHint: optional(pipe(string(), minLength(2), maxLength(64))),
  blocks: pipe(array(CharacterSourceBlockSchema), minLength(1), maxLength(20_000)),
})

/** Possible primary character discovered before field extraction. */
export const CharacterCandidateSchema = strictObject({
  candidateId: identifier,
  name: shortText,
  aliases: pipe(array(shortText), maxLength(64)),
  evidenceBlockIds: evidenceIds,
  ambiguity: picklist(['clear', 'multiple-primary-candidates', 'insufficient-evidence']),
})

/** Evidence status kept separate from model confidence. */
export const CharacterSupportStatusSchema = picklist(['explicit', 'inferred', 'ambiguous'])

/** Grounded string value used by identity and draft fields. */
export const GroundedCharacterStringSchema = strictObject({
  value: sourceText,
  supportStatus: CharacterSupportStatusSchema,
  evidenceBlockIds: pipe(array(identifier), maxLength(64)),
  quote: optional(pipe(string(), maxLength(2_000)), ''),
  evidenceValidation: picklist(['unverified', 'verified', 'rejected']),
  userConfirmed: optional(boolean(), false),
  origin: optional(picklist(['source', 'synthetic', 'user'])),
  sourceFactIds: optional(pipe(array(identifier), maxLength(128))),
})

/** Atomic fact extracted from one or more source blocks. */
export const CharacterFactSchema = strictObject({
  factId: identifier,
  candidateId: optional(identifier),
  category: picklist([
    'identity',
    'personality',
    'language-style',
    'background',
    'relationship',
    'scenario',
    'dialogue',
    'location',
    'organization',
    'npc',
    'history',
    'item',
    'ability',
    'world-rule',
  ]),
  predicate: optional(identifier),
  entityNames: optional(pipe(array(shortText), maxLength(64))),
  value: sourceText,
  supportStatus: CharacterSupportStatusSchema,
  evidenceBlockIds: evidenceIds,
  quote: pipe(string(), minLength(1), maxLength(2_000)),
  evidenceValidation: picklist(['unverified', 'verified', 'rejected']),
})

/** Mutually incompatible facts that require explicit review. */
export const CharacterConflictSchema = strictObject({
  conflictId: identifier,
  category: picklist(['age', 'identity', 'timeline', 'relationship', 'ability', 'attitude', 'world-rule', 'other']),
  factIds: pipe(array(identifier), minLength(2), maxLength(32)),
  status: picklist(['unresolved', 'keep-one', 'keep-both', 'discard-all']),
  selectedFactIds: optional(pipe(array(identifier), maxLength(32)), []),
})

/** Versioned evidence-bearing analysis before deterministic draft compilation. */
export const CharacterSourceAnalysisV1Schema = strictObject({
  schemaVersion: literal(1),
  documentId: identifier,
  candidates: pipe(array(CharacterCandidateSchema), maxLength(128)),
  selectedCandidateId: optional(identifier),
  facts: pipe(array(CharacterFactSchema), maxLength(10_000)),
  conflicts: pipe(array(CharacterConflictSchema), maxLength(2_000)),
  unclassifiedBlockIds: pipe(array(identifier), maxLength(20_000)),
})

/** Editable language style kept structured instead of one opaque adjective. */
export const CharacterLanguageStyleSchema = strictObject({
  tone: pipe(array(shortText), maxLength(32)),
  addressTerms: pipe(array(shortText), maxLength(32)),
  pronouns: pipe(array(shortText), maxLength(32)),
  sentencePatterns: pipe(array(shortText), maxLength(32)),
  vocabulary: pipe(array(shortText), maxLength(64)),
  catchphrases: pipe(array(shortText), maxLength(64)),
  emotionalExpression: pipe(array(shortText), maxLength(32)),
  prohibitedExpressions: pipe(array(shortText), maxLength(64)),
})

/** Reviewable lore entry before conversion to the standard CCv3 CharacterBook. */
export const CharacterDraftLoreEntrySchema = strictObject({
  draftEntryId: identifier,
  name: optional(shortText),
  content: editableSourceText,
  keys: pipe(array(shortText), maxLength(64)),
  secondaryKeys: optional(pipe(array(shortText), maxLength(64))),
  selective: optional(boolean()),
  useRegex: optional(boolean()),
  caseSensitive: optional(boolean()),
  constant: optional(boolean(), false),
  priority: optional(pipe(number(), integer())),
  insertionOrder: optional(pipe(number(), integer())),
  position: optional(picklist(['after_char', 'before_char'])),
  sourceFactIds: pipe(array(identifier), maxLength(128)),
})

export const CharacterDraftPromptSourceSchema = strictObject({
  sectionId: identifier,
  sourceFactIds: pipe(array(identifier), maxLength(128)),
})

export const CharacterUnclassifiedExcerptSchema = strictObject({
  blockId: identifier,
  text: pipe(string(), minLength(1), maxLength(2_000)),
})

/** Editable book-level CCv3 settings retained separately from entry facts. */
export const CharacterDraftLoreBookSchema = strictObject({
  name: optional(shortText),
  description: optional(sourceText),
  scanDepth: optional(pipe(number(), integer(), minValue(0), maxValue(256))),
  tokenBudget: optional(pipe(number(), integer(), minValue(0), maxValue(1_000_000))),
  recursiveScanning: optional(boolean()),
})

/** Editable, non-activated result compiled only from reviewed evidence. */
export const CharacterDraftSchema = strictObject({
  schemaVersion: literal(1),
  draftId: identifier,
  documentId: identifier,
  selectedCandidateId: optional(identifier),
  name: optional(GroundedCharacterStringSchema),
  nickname: optional(GroundedCharacterStringSchema),
  description: optional(GroundedCharacterStringSchema),
  story: pipe(array(GroundedCharacterStringSchema), maxLength(128)),
  relationships: pipe(array(GroundedCharacterStringSchema), maxLength(128)),
  personality: pipe(array(GroundedCharacterStringSchema), maxLength(128)),
  scenario: optional(GroundedCharacterStringSchema),
  languageStyle: CharacterLanguageStyleSchema,
  greetings: pipe(array(GroundedCharacterStringSchema), maxLength(32)),
  messageExamples: pipe(array(GroundedCharacterStringSchema), maxLength(64)),
  loreBook: CharacterDraftLoreBookSchema,
  loreEntries: pipe(array(CharacterDraftLoreEntrySchema), maxLength(2_000)),
  facts: pipe(array(CharacterFactSchema), maxLength(10_000)),
  confirmedFactIds: pipe(array(identifier), maxLength(10_000)),
  conflicts: pipe(array(CharacterConflictSchema), maxLength(2_000)),
  unclassifiedBlockIds: pipe(array(identifier), maxLength(20_000)),
  unclassifiedExcerpts: pipe(array(CharacterUnclassifiedExcerptSchema), maxLength(256)),
  promptSectionSources: pipe(array(CharacterDraftPromptSourceSchema), maxLength(512)),
  blockingReasonCodes: pipe(array(identifier), maxLength(512)),
  exportWarningCodes: pipe(array(identifier), maxLength(512)),
  warningCodes: pipe(array(identifier), maxLength(512)),
})

const jobCommon = {
  schemaVersion: literal(1),
  jobId: identifier,
  documentId: identifier,
  completedUnits: pipe(number(), integer(), minValue(0)),
  totalUnits: pipe(number(), integer(), minValue(0)),
  metadata: strictObject({
    providerId: identifier,
    modelId: shortText,
    extractorSchemaVersion: shortText,
    extractorPromptVersion: shortText,
    segmenterVersion: shortText,
    retryCount: pipe(number(), integer(), minValue(0)),
    startedAt: pipe(number(), integer(), minValue(0)),
    updatedAt: pipe(number(), integer(), minValue(0)),
    parameters: strictObject({
      blocksPerBatch: pipe(number(), integer(), minValue(1)),
      concurrentBatches: pipe(number(), integer(), minValue(1)),
      maxRetries: pipe(number(), integer(), minValue(0)),
    }),
  }),
}

/** Finite extraction lifecycle; terminal states cannot be confused with active work. */
export const CharacterExtractionJobSchema = union([
  strictObject({ ...jobCommon, state: picklist(['reading', 'segmenting', 'discovering-candidates', 'extracting', 'merging', 'reviewing']) }),
  strictObject({ ...jobCommon, state: literal('awaiting-character-selection'), candidateIds: pipe(array(identifier), minLength(1), maxLength(128)) }),
  strictObject({ ...jobCommon, state: literal('completed'), draftId: identifier }),
  strictObject({ ...jobCommon, state: literal('failed'), errorCode: identifier, retryable: boolean() }),
  strictObject({ ...jobCommon, state: literal('cancelled') }),
])

export type CharacterSourceFormat = InferOutput<typeof CharacterSourceFormatSchema>
export type CharacterSourceBlock = InferOutput<typeof CharacterSourceBlockSchema>
export type CharacterSourceDocument = InferOutput<typeof CharacterSourceDocumentSchema>
export type CharacterCandidate = InferOutput<typeof CharacterCandidateSchema>
export type CharacterSupportStatus = InferOutput<typeof CharacterSupportStatusSchema>
export type GroundedCharacterValue<T> = Omit<InferOutput<typeof GroundedCharacterStringSchema>, 'value'> & { value: T }
export type CharacterFact = InferOutput<typeof CharacterFactSchema>
export type CharacterConflict = InferOutput<typeof CharacterConflictSchema>
export type CharacterSourceAnalysisV1 = InferOutput<typeof CharacterSourceAnalysisV1Schema>
export type CharacterDraft = InferOutput<typeof CharacterDraftSchema>
export type CharacterDraftLoreEntry = InferOutput<typeof CharacterDraftLoreEntrySchema>
export type CharacterExtractionJob = InferOutput<typeof CharacterExtractionJobSchema>
