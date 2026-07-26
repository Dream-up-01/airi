import { readFile } from 'node:fs/promises'

import { validateCompanionPreset } from '@proj-airi/stage-ui/domains/companion'
import { describe, expect, it } from 'vitest'

import { parseCompanionPresetFile } from './companionPreset'

describe('desktop companion preset parser', () => {
  it('parses and validates the versioned Qiyao YAML fixture', async () => {
    const fixtureUrl = new URL('../../../../../docs/cn-companion/presets/qiyao-v0.1.yaml', import.meta.url)
    const content = await readFile(fixtureUrl, 'utf8')
    const parsed = parseCompanionPresetFile({ content, fileName: 'qiyao-v0.1.yaml' })
    const result = validateCompanionPreset(parsed)

    expect(result.success).toBe(true)
    if (!result.success)
      throw new Error(`Fixture validation failed: ${JSON.stringify(result.errors)}`)
    expect(result.value.id).toBe('qiyao-cn-companion')
  })

  it('rejects duplicate YAML keys', () => {
    expect(() => parseCompanionPresetFile({
      fileName: 'duplicate.yaml',
      content: 'schema_version: 1\nschema_version: 2\n',
    })).toThrow()
  })

  it('rejects payloads whose basename does not match the shared file contract', () => {
    expect(() => parseCompanionPresetFile({
      fileName: 'preset.txt',
      content: 'schema_version: 1',
    })).toThrow('Unsupported companion preset extension')
  })

  it('rejects duplicate JSON keys', () => {
    expect(() => parseCompanionPresetFile({
      fileName: 'duplicate.json',
      content: '{"schema_version":1,"schema_version":2}',
    })).toThrow()
  })
})
