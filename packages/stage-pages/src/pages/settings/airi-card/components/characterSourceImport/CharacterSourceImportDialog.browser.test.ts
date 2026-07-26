import type { CharacterSourceFileReader } from '@proj-airi/stage-ui/composables/characterSourceFileReader'
import type { CharacterDraft, CharacterExtractionJob } from '@proj-airi/stage-ui/domains/characterSource'

import { createTestingPinia } from '@pinia/testing'
import { provideCharacterSourceFileReader } from '@proj-airi/stage-ui/composables/characterSourceFileReader'
import { useCharacterSourceImportStore } from '@proj-airi/stage-ui/stores/characterSourceImport'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import CharacterSourceImportDialog from './CharacterSourceImportDialog.vue'

const contentHash = '0123456789abcdef'.repeat(4)

function draft(): CharacterDraft {
  return {
    schemaVersion: 1,
    draftId: 'draft-1',
    documentId: 'source-document-1',
    selectedCandidateId: 'candidate-1',
    name: {
      value: '栖遥',
      supportStatus: 'explicit',
      evidenceBlockIds: ['block-00001'],
      quote: '角色名：栖遥',
      evidenceValidation: 'verified',
      userConfirmed: true,
      origin: 'source',
      sourceFactIds: ['fact-name'],
    },
    description: undefined,
    story: [],
    relationships: [],
    personality: [],
    scenario: undefined,
    languageStyle: {
      tone: [],
      addressTerms: [],
      pronouns: [],
      sentencePatterns: [],
      vocabulary: [],
      catchphrases: [],
      emotionalExpression: [],
      prohibitedExpressions: [],
    },
    greetings: [],
    messageExamples: [],
    loreBook: {},
    loreEntries: [],
    facts: [{
      factId: 'fact-name',
      candidateId: 'candidate-1',
      category: 'identity',
      predicate: 'name',
      value: '栖遥',
      supportStatus: 'explicit',
      evidenceBlockIds: ['block-00001'],
      quote: '角色名：栖遥',
      evidenceValidation: 'verified',
    }],
    confirmedFactIds: [],
    conflicts: [],
    unclassifiedBlockIds: [],
    unclassifiedExcerpts: [],
    promptSectionSources: [{ sectionId: 'character.identity', sourceFactIds: ['fact-name'] }],
    blockingReasonCodes: [],
    exportWarningCodes: [],
    warningCodes: [],
  }
}

function i18n() {
  return createI18n({
    legacy: false,
    locale: 'zh-Hans',
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      'zh-Hans': {
        settings: {
          pages: {
            card: {
              cancel: '取消',
              name: '名称',
              personality: '性格',
              description: '描述',
              scenario: '场景',
              character_source_import: {
                title: '从文本导入角色',
                entry_description: '导入角色设定',
                file_label: '角色设定文件',
                supported_formats: '支持纯文本格式',
                pick_file: '选择文件',
                provider_label: '分析服务来源',
                model_label: '分析模型',
                no_provider: '无服务来源',
                cloud_confirm: '确认上传',
                redaction_notice: '上传前替换 {count} 处敏感值',
                start: '开始分析',
                select_candidate: '选择角色',
                select_candidate_hint: '选择主要角色',
                evidence_blocks: '{count} 个证据块',
                summary_title: '确认创建',
                items: '项',
                lore_entries: '世界书条目',
                not_activated_notice: '不会自动激活',
                create_card: '创建角色卡',
                back: '返回',
                unconfirmed_inferred: '未确认推断',
                warnings: '警告',
                blocking_issues: '阻塞问题',
                error: '分析失败',
                errors: { unknown: '未知错误' },
                conflicts_title: '处理事实冲突',
                conflicts_hint: '请选择保留方式',
                conflict_category: '冲突：{category}',
                keep_both: '全部保留',
                discard_all: '全部舍弃',
                review_title: '审阅角色草稿',
                unresolved_conflicts: '存在未解决冲突',
                evidence: '来源证据',
                support: { explicit: '明确', inferred: '推断', ambiguous: '歧义' },
                evidence_status: { verified: '已验证', unverified: '未验证', rejected: '已拒绝' },
                confirm_inferred: '确认推断',
                inferred_lore_title: '推断出的世界书事实需要逐项确认',
                name_required: '必须填写角色名称',
                retry_count: '重试次数',
                proceed_to_confirm: '检查并创建',
                story: '背景故事',
                relationships: '人物关系',
                greetings: '问候语',
                message_examples: '对话示例',
                style: {
                  tone: '语气',
                  address_terms: '称谓',
                  pronouns: '代词',
                  sentence_patterns: '句式',
                  vocabulary: '用词',
                  catchphrases: '口头禅',
                  emotional_expression: '情绪表达',
                  prohibited_expressions: '禁止表达',
                },
                state: { awaiting_selection: '等待选择' },
              },
              worldbook: {
                title: '世界书',
                description: '世界书说明',
                add_entry: '添加条目',
                name: '世界书名称',
                scan_depth: '扫描深度',
                token_budget: 'Token 预算',
                recursive_scanning: '递归扫描',
                book_description: '世界书描述',
                empty: '暂无条目',
              },
            },
          },
        },
      },
    },
  })
}

function harness(reader: CharacterSourceFileReader) {
  return defineComponent({
    components: { CharacterSourceImportDialog },
    setup() {
      provideCharacterSourceFileReader(reader)
      const open = shallowRef(true)
      const createdCardId = shallowRef('none')
      return { createdCardId, open }
    },
    template: `
      <CharacterSourceImportDialog v-model="open" @created="createdCardId = $event" />
      <output aria-label="created-card-id">{{ createdCardId }}</output>
    `,
  })
}

function reader(content = '角色名：栖遥'): CharacterSourceFileReader {
  return {
    cancel: vi.fn(async () => {}),
    pick: vi.fn(async () => ({
      status: 'selected' as const,
      file: { content, contentHash, fileName: 'character.txt' },
    })),
  }
}

function jobAwaitingSelection(): CharacterExtractionJob {
  const now = Date.now()
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    documentId: 'source-document-1',
    state: 'awaiting-character-selection',
    candidateIds: ['candidate-1', 'candidate-2'],
    completedUnits: 0,
    totalUnits: 2,
    metadata: {
      providerId: 'provider-1',
      modelId: 'model-1',
      extractorSchemaVersion: '1',
      extractorPromptVersion: '2.0.0',
      segmenterVersion: '1',
      retryCount: 0,
      startedAt: now,
      updatedAt: now,
      parameters: { blocksPerBatch: 20, concurrentBatches: 3, maxRetries: 2 },
    },
  }
}

describe('character source import dialog', () => {
  it('selects a local source and explains redaction before upload confirmation', async () => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: true,
      initialState: { 'character-source-import': { step: 'picking' } },
    })
    const screen = await render(harness(reader('角色名：栖遥\n令牌：sk-abcdefghijklmnop')), {
      global: { plugins: [pinia, i18n()] },
    })

    await screen.getByRole('button', { name: '选择文件' }).click()

    await expect.element(screen.getByText('character.txt')).toBeVisible()
    await expect.element(screen.getByText('上传前替换 1 处敏感值')).toBeVisible()
    const confirmation = screen.getByRole('checkbox')
    await confirmation.click()
    await expect.element(confirmation).toBeChecked()
    await screen.getByRole('button', { name: 'character.txt' }).click()
    await expect.element(confirmation).not.toBeChecked()
    expect(pinia.state.value['airi-card']).toBeUndefined()
  })

  it('pauses a multi-character job and delegates only the selected candidate', async () => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: true,
      initialState: {
        'character-source-import': { step: 'extracting' },
        'character-extraction': {
          job: jobAwaitingSelection(),
          candidates: [
            { candidateId: 'candidate-1', name: '栖遥', aliases: [], evidenceBlockIds: ['block-00001'], ambiguity: 'multiple-primary-candidates' },
            { candidateId: 'candidate-2', name: '林渡', aliases: [], evidenceBlockIds: ['block-00002'], ambiguity: 'multiple-primary-candidates' },
          ],
        },
      },
    })
    const screen = await render(harness(reader()), { global: { plugins: [pinia, i18n()] } })
    const importStore = useCharacterSourceImportStore(pinia)

    await screen.getByRole('button', { name: /栖遥/u }).click()

    expect(importStore.selectCandidate).toHaveBeenCalledOnce()
    expect(importStore.selectCandidate).toHaveBeenCalledWith('candidate-1')
    expect(pinia.state.value['airi-card']).toBeUndefined()
  })

  it('emits one created card ID from final confirmation without activating a card in preview', async () => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: true,
      initialState: {
        'character-source-import': { step: 'confirming', editableDraft: draft() },
      },
    })
    const screen = await render(harness(reader()), { global: { plugins: [pinia, i18n()] } })
    const importStore = useCharacterSourceImportStore(pinia)
    vi.mocked(importStore.confirmAndCreateCard).mockReturnValue('card-created')
    await screen.getByRole('button', { name: '创建角色卡' }).click()

    await expect.element(screen.getByLabelText('created-card-id')).toHaveTextContent('card-created')
    expect(importStore.confirmAndCreateCard).toHaveBeenCalledOnce()
    expect(pinia.state.value['airi-card']).toBeUndefined()
  })

  it('renders evidence as text, delegates conflict resolution, and writes editor events only to the import store', async () => {
    const reviewingDraft = draft()
    reviewingDraft.name = {
      ...reviewingDraft.name!,
      quote: '<img src=x onerror="globalThis.compromised=true">角色名：栖遥',
    }
    reviewingDraft.facts.push({
      ...reviewingDraft.facts[0]!,
      factId: 'fact-name-other',
      value: '绮遥',
      quote: '另一个版本称她为绮遥',
    })
    reviewingDraft.facts.push({
      factId: 'fact-lore-inferred',
      candidateId: 'candidate-1',
      category: 'world-rule',
      predicate: 'world-rule.weather',
      value: '浮光镇可能终年多雾。',
      supportStatus: 'inferred',
      evidenceBlockIds: ['block-00001'],
      quote: '浮光镇的雾似乎从未散去。',
      evidenceValidation: 'verified',
    })
    reviewingDraft.loreEntries = [{
      draftEntryId: 'lore-inferred',
      content: '浮光镇可能终年多雾。',
      keys: [],
      constant: true,
      sourceFactIds: ['fact-lore-inferred'],
    }]
    reviewingDraft.conflicts = [{
      conflictId: 'conflict-name',
      category: 'identity',
      factIds: ['fact-name', 'fact-name-other'],
      status: 'unresolved',
      selectedFactIds: [],
    }]
    reviewingDraft.blockingReasonCodes = ['unresolved-conflicts']
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: true,
      initialState: { 'character-source-import': { step: 'reviewing', editableDraft: reviewingDraft } },
    })
    const screen = await render(harness(reader()), { global: { plugins: [pinia, i18n()] } })
    const importStore = useCharacterSourceImportStore(pinia)

    expect(document.querySelector('img[src="x"]')).toBeNull()
    await screen.getByText(/来源证据/u).first().click()
    await expect.element(screen.getByText(/<img src=x/u)).toBeVisible()

    await screen.getByRole('button', { name: /绮遥/u }).click()
    expect(importStore.resolveConflict).toHaveBeenCalledWith('conflict-name', {
      status: 'keep-one',
      selectedFactIds: ['fact-name-other'],
    })

    await screen.getByRole('textbox').first().fill('用户修订名')
    expect(importStore.updateDraftField).toHaveBeenCalledWith('name', expect.objectContaining({ value: '用户修订名' }))

    await screen.getByRole('button', { name: '添加条目' }).click()
    expect(importStore.replaceLoreEntries).toHaveBeenCalledOnce()
    await screen.getByRole('button', { name: '确认推断' }).click()
    expect(importStore.confirmFacts).toHaveBeenCalledWith(['fact-lore-inferred'])
    expect(pinia.state.value['airi-card']).toBeUndefined()
  })

  it('shows a stable failure and clears the import when cancelled', async () => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: true,
      initialState: { 'character-source-import': { step: 'error', errorCode: 'unknown' } },
    })
    const screen = await render(harness(reader()), { global: { plugins: [pinia, i18n()] } })
    const importStore = useCharacterSourceImportStore(pinia)

    await expect.element(screen.getByText('未知错误')).toBeVisible()
    await screen.getByRole('button', { name: '取消' }).click()

    expect(importStore.cancelImport).toHaveBeenCalledOnce()
    expect(pinia.state.value['airi-card']).toBeUndefined()
  })
})
