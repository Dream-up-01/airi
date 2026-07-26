import type { CharacterSourceFileReader } from './characterSourceFileReader'

import { describe, expect, it } from 'vitest'

import { createCharacterSourceDocumentSession } from './characterSourceFileReader'

const contentHash = '0123456789abcdef'.repeat(4)

describe('character source document session', () => {
  it('retains source blocks only until explicit completion cleanup', async () => {
    const reader: CharacterSourceFileReader = {
      cancel: async () => {},
      pick: async () => ({
        status: 'selected',
        file: { content: 'name: 栖遥', contentHash, fileName: 'character.txt' },
      }),
    }
    const session = createCharacterSourceDocumentSession(reader, () => 'request:1')

    const document = await session.select()
    expect(document?.blocks[0]?.text).toContain('栖遥')
    expect(session.document.value).toBe(document)

    session.clear()
    expect(session.document.value).toBeUndefined()
  })

  it('clears source state on platform failure', async () => {
    const reader: CharacterSourceFileReader = {
      cancel: async () => {},
      pick: async () => ({ status: 'error', error: 'invalid_utf8' }),
    }
    const session = createCharacterSourceDocumentSession(reader, () => 'request:1')

    await expect(session.select()).rejects.toEqual(expect.objectContaining({ code: 'invalid_utf8' }))
    expect(session.document.value).toBeUndefined()
  })

  it('cancels superseded work and ignores its stale result', async () => {
    let resolveFirst: ((result: Awaited<ReturnType<CharacterSourceFileReader['pick']>>) => void) | undefined
    const cancelled: string[] = []
    const reader: CharacterSourceFileReader = {
      cancel: async requestId => void cancelled.push(requestId),
      pick: requestId => requestId === 'request:1'
        ? new Promise((resolve) => { resolveFirst = resolve })
        : Promise.resolve({
            status: 'selected',
            file: { content: 'name: 新角色', contentHash, fileName: 'new.txt' },
          }),
    }
    const requestIds = ['request:1', 'request:2']
    const session = createCharacterSourceDocumentSession(reader, () => requestIds.shift()!)

    const first = session.select()
    await Promise.resolve()
    const second = session.select()
    await expect(second).resolves.toEqual(expect.objectContaining({ displayName: 'new.txt' }))
    resolveFirst?.({
      status: 'selected',
      file: { content: 'name: 旧角色', contentHash, fileName: 'old.txt' },
    })

    await expect(first).resolves.toBeUndefined()
    expect(cancelled).toContain('request:1')
    expect(session.document.value?.displayName).toBe('new.txt')
  })

  it('cancels and clears when the owner is abandoned', async () => {
    const cancelled: string[] = []
    const reader: CharacterSourceFileReader = {
      cancel: async requestId => void cancelled.push(requestId),
      pick: async () => new Promise(() => {}),
    }
    const session = createCharacterSourceDocumentSession(reader, () => 'request:1')

    void session.select()
    await Promise.resolve()
    await session.cancel()

    expect(cancelled).toEqual(['request:1'])
    expect(session.document.value).toBeUndefined()
  })
})
