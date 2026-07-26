import type { CharacterSourceFileReaderDependencies } from './characterSource'

import JSZip from 'jszip'

import { describe, expect, it } from 'vitest'

import { createCharacterSourceFileReader, extractDocxText } from './characterSource'

function createDependencies(overrides: Partial<CharacterSourceFileReaderDependencies> = {}): CharacterSourceFileReaderDependencies {
  const bytes = new TextEncoder().encode('name: 栖遥')
  return {
    extractDocxText,
    hashBytes: () => 'a'.repeat(64),
    pickFile: async () => '/private/character.md',
    readFileBytes: async () => bytes,
    readFileSnapshot: async () => ({ identity: '1:2', modifiedAt: 100, size: bytes.byteLength }),
    ...overrides,
  }
}

describe('character source file reader', () => {
  it('returns strict UTF-8 content, a trusted hash, and no absolute path', async () => {
    const reader = createCharacterSourceFileReader(createDependencies())
    const result = await reader('request:1', new AbortController().signal)

    expect(result).toEqual({
      status: 'selected',
      file: {
        content: 'name: 栖遥',
        contentHash: 'a'.repeat(64),
        fileName: 'character.md',
        format: 'md',
      },
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('rejects unsupported types before reading bytes', async () => {
    let read = false
    const reader = createCharacterSourceFileReader(createDependencies({
      pickFile: async () => 'character.doc',
      readFileBytes: async () => {
        read = true
        return new Uint8Array()
      },
    }))

    await expect(reader('request:1', new AbortController().signal)).resolves.toEqual({ status: 'error', error: 'unsupported_extension' })
    expect(read).toBe(false)
  })

  it('extracts DOCX paragraphs, entities, tabs, and line breaks', async () => {
    const archive = new JSZip()
    archive.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>姓名：栖遥 &amp; AIRI</w:t></w:r></w:p>
          <w:p><w:r><w:t>特征</w:t><w:tab/><w:t>温柔</w:t><w:br/><w:t>坚定</w:t></w:r></w:p>
        </w:body>
      </w:document>`)
    const bytes = await archive.generateAsync({ type: 'uint8array' })

    await expect(extractDocxText(bytes, new AbortController().signal)).resolves.toBe('姓名：栖遥 & AIRI\n特征\t温柔\n坚定')
  })

  it('returns extracted DOCX text through the existing sanitized file contract', async () => {
    const archive = new JSZip()
    archive.file('word/document.xml', '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>角色名：栖遥</w:t></w:r></w:p></w:body></w:document>')
    const bytes = await archive.generateAsync({ type: 'uint8array' })
    const reader = createCharacterSourceFileReader(createDependencies({
      pickFile: async () => 'C:\\private\\character.docx',
      readFileBytes: async () => bytes,
      readFileSnapshot: async () => ({ identity: '1:2', modifiedAt: 100, size: bytes.byteLength }),
    }))

    const result = await reader('request:docx', new AbortController().signal)
    expect(result).toMatchObject({
      status: 'selected',
      file: {
        content: '角色名：栖遥',
        fileName: 'character.docx',
        format: 'docx',
      },
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('rejects malformed DOCX archives with a stable error', async () => {
    const bytes = new TextEncoder().encode('not-a-zip')
    const reader = createCharacterSourceFileReader(createDependencies({
      pickFile: async () => 'character.docx',
      readFileBytes: async () => bytes,
      readFileSnapshot: async () => ({ modifiedAt: 100, size: bytes.byteLength }),
    }))

    await expect(reader('request:docx', new AbortController().signal)).resolves.toEqual({ status: 'error', error: 'invalid_docx' })
  })

  it('rejects oversized files before allocating their content', async () => {
    const reader = createCharacterSourceFileReader(createDependencies({
      readFileSnapshot: async () => ({ size: 1_000_001, modifiedAt: 100 }),
    }))

    await expect(reader('request:1', new AbortController().signal)).resolves.toEqual({ status: 'error', error: 'file_too_large' })
  })

  it('rejects file replacement or modification during reading', async () => {
    let snapshotCount = 0
    const reader = createCharacterSourceFileReader(createDependencies({
      readFileSnapshot: async () => ({
        identity: snapshotCount++ === 0 ? '1:2' : '1:3',
        modifiedAt: 100,
        size: 12,
      }),
    }))

    await expect(reader('request:1', new AbortController().signal)).resolves.toEqual({ status: 'error', error: 'file_changed_during_read' })
  })

  it('rejects malformed UTF-8 without replacement characters', async () => {
    const reader = createCharacterSourceFileReader(createDependencies({
      readFileBytes: async () => new Uint8Array([0xFF]),
      readFileSnapshot: async () => ({ size: 1, modifiedAt: 100 }),
    }))

    await expect(reader('request:1', new AbortController().signal)).resolves.toEqual({ status: 'error', error: 'invalid_utf8' })
  })

  it('returns cancellation after a stale or user-cancelled request', async () => {
    const controller = new AbortController()
    const reader = createCharacterSourceFileReader(createDependencies({
      pickFile: async () => {
        controller.abort('stale-request')
        return 'character.txt'
      },
    }))

    await expect(reader('request:1', controller.signal)).resolves.toEqual({ status: 'cancelled' })
  })

  it('rejects malformed correlation IDs', async () => {
    const reader = createCharacterSourceFileReader(createDependencies())

    await expect(reader('../request', new AbortController().signal)).resolves.toEqual({ status: 'error', error: 'invalid_request' })
  })
})
