// packages/pipelines-audio/src/processors/tts-chunker.test.ts

import { describe, expect, it } from 'vitest'

import { chunkTtsInput, isProbablyAngleTag, processNarrative, TTS_FLUSH_INSTRUCTION } from './tts-chunker'

async function collectChunks(input: string, options?: Parameters<typeof chunkTtsInput>[1]) {
  const chunks = []
  for await (const chunk of chunkTtsInput(input, options))
    chunks.push(chunk)

  return chunks
}

describe('tTS Chunker Logic Cleanup', () => {
  describe('isProbablyAngleTag Heuristics', () => {
    it('should identify narrative tags', () => {
      expect(isProbablyAngleTag(0, '<sigh>')).toBe(true)
    })

    it('should skip code patterns like generics', () => {
      expect(isProbablyAngleTag(4, 'List<String>')).toBe(false)
      expect(isProbablyAngleTag(1, 'x<y')).toBe(false)
    })
  })

  describe('processNarrative Function', () => {
    const options = { stripNarrative: true }

    it('should strip standard bracketed narrative', () => {
      expect(processNarrative('Hello [sighs] world', options)).toBe('Hello  world')
      expect(processNarrative('<<tag>>', options)).toBe('')
    })

    it('should restore stripping for CJK brackets', () => {
      expect(processNarrative('你好（叹气）世界', options)).toBe('你好世界')
      expect(processNarrative('【动作】你好', options)).toBe('你好')
    })

    it('should fix asterisk bullet leakage', () => {
      expect(processNarrative('* item 1', options)).toBe('* item 1')
      expect(processNarrative('*bold text*', options)).toBe('')
      expect(processNarrative('a*b', options)).toBe('a*b')
    })

    it('should handle complex nesting correctly', () => {
      expect(processNarrative('Normal (nested [action]) text', options)).toBe('Normal  text')
    })

    it('should handle open bracket correctly', () => {
      expect(processNarrative('Version (beta', options)).toBe('Version (beta')
    })

    it('should handle valid narrative tag', () => {
      expect(processNarrative('Hello,<laugh>', options)).toBe('Hello,')
      expect(processNarrative('Hello<laugh>', options)).toBe('Hello')
      expect(processNarrative('<laughs>Hello', options)).toBe('Hello')
      expect(processNarrative('Hello<laughs>', options)).toBe('Hello')
      expect(processNarrative('你好<laughs>', options)).toBe('你好')
      expect(processNarrative('List<T>', options)).toBe('List<T>')
    })

    it('should preserve code literals in keepNarrativeText mode', () => {
      const keepOptions = { stripNarrative: true, keepNarrativeText: true }
      expect(processNarrative('Value is List<String> [action]', keepOptions)).toContain('List<String>')
      expect(processNarrative('x < y (sigh)', keepOptions)).toContain('x < y')
      expect(processNarrative('price<limit', keepOptions)).toContain('price<limit')
    })

    it('should be case-insensitive for narrative tags', () => {
      const options = { stripNarrative: true }
      expect(processNarrative('Hello<LAUGHs>', options)).toBe('Hello')
      expect(processNarrative('abc<Action>', options)).toBe('abc')
      expect(processNarrative('List<String>', options)).toBe('List<String>')
    })
  })

  describe('isProbablyAngleTag Stream Prefix Handling', () => {
    it('should identify partial prefixes of narrative keywords', () => {
      expect(isProbablyAngleTag(5, 'hello<sm')).toBe(true)
      expect(isProbablyAngleTag(5, 'hello<la')).toBe(true) // laugh 的前缀
    })

    it('should not identify non-narrative prefixes as tags', () => {
      expect(isProbablyAngleTag(4, 'List<Str')).toBe(false)
    })
  })

  describe('edge Cases test', () => {
    it('should not treat single-letter operands as narrative prefixes', () => {
      expect(isProbablyAngleTag(1, 'a<b')).toBe(false)
      expect(isProbablyAngleTag(1, 'x<s')).toBe(false)
    })

    it('should support non-CJK Unicode letters as tag context', () => {
      expect(isProbablyAngleTag(4, 'café<laugh>')).toBe(true)
      expect(isProbablyAngleTag(6, 'привет<sigh>')).toBe(true)
    })
  })

  describe('chinese speech chunking', () => {
    it('should emit an early chunk at a Chinese soft boundary, then hard sentence boundaries', async () => {
      const chunks = await collectChunks('你好呀，今天想先聊点轻松的吗？我会慢慢听你说。', {
        boost: 1,
        minimumWords: 2,
        maximumWords: 12,
      })

      expect(chunks.map(chunk => chunk.text)).toEqual([
        '你好呀，',
        '今天想先聊点轻松的吗？',
        '我会慢慢听你说。',
      ])
      expect(chunks.map(chunk => chunk.reason)).toEqual(['boost', 'hard', 'hard'])
    })

    it('should not split inside URLs or decimal numbers', async () => {
      const chunks = await collectChunks('你可以打开 https://airi.example/path?a=1.2，然后告诉我。', {
        boost: 0,
        minimumWords: 4,
        maximumWords: 24,
      })

      expect(chunks).toHaveLength(1)
      expect(chunks[0]?.text).toBe('你可以打开 https://airi.example/path?a=1.2，然后告诉我。')
    })

    it('should preserve common English abbreviations and code-ish dotted tokens', async () => {
      const chunks = await collectChunks('请看 Dr. Smith 的 v1.2 更新，然后继续。', {
        boost: 0,
        minimumWords: 4,
        maximumWords: 24,
      })

      expect(chunks).toHaveLength(1)
      expect(chunks[0]?.text).toBe('请看 Dr. Smith 的 v1.2 更新，然后继续。')
    })

    it('should support explicit flush tokens', async () => {
      const chunks = await collectChunks(`先说第一句${TTS_FLUSH_INSTRUCTION}再说第二句`, {
        boost: 0,
        minimumWords: 4,
        maximumWords: 24,
      })

      expect(chunks.map(chunk => chunk.text)).toEqual(['先说第一句', '再说第二句'])
      expect(chunks.map(chunk => chunk.reason)).toEqual(['flush', 'flush'])
    })

    it('should preserve two-dot pauses and normalize three-dot ellipsis boundaries', async () => {
      const twoDotChunks = await collectChunks('等一下.. 然后继续。', {
        boost: 0,
        minimumWords: 4,
        maximumWords: 24,
      })
      const ellipsisChunks = await collectChunks('等一下... 然后继续。', {
        boost: 0,
        minimumWords: 4,
        maximumWords: 24,
      })

      expect(twoDotChunks[0]?.text).toBe('等一下.. 然后继续。')
      expect(ellipsisChunks[0]?.text).toBe('等一下…')
    })
  })
})
