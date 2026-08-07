import { describe, expect, it } from 'vitest'

import enStage from '../../../../../../packages/i18n/src/locales/en/tamagotchi/stage.yaml?raw'
import zhHansStage from '../../../../../../packages/i18n/src/locales/zh-Hans/tamagotchi/stage.yaml?raw'
import zhHantStage from '../../../../../../packages/i18n/src/locales/zh-Hant/tamagotchi/stage.yaml?raw'

describe('cloud perception policy copy', () => {
  it.each([
    {
      locale: 'en',
      source: enStage,
      localMemoryOnly: 'AIRI keeps local raw audio and frames memory-only',
      providerRetention: 'Data sent to Qwen may enter service logs retained for one month',
      sessionContextRetention: 'model session context cleared immediately on disconnect',
      regionBoundary: 'China mainland Endpoint traffic does not cross regions or borders',
      consentRetention: 'uploaded frames may enter service logs retained for one month',
    },
    {
      locale: 'zh-Hans',
      source: zhHansStage,
      localMemoryOnly: 'AIRI 本地侧的原始音频与画面仅在内存中短暂存在',
      providerRetention: '已发送至千问的数据可能进入保留一个月的服务日志',
      sessionContextRetention: '断连立即清除模型会话上下文',
      regionBoundary: '中国内地 Endpoint 的数据不会跨地域或跨境传输',
      consentRetention: '上传画面可能进入保留一个月的服务日志',
    },
    {
      locale: 'zh-Hant',
      source: zhHantStage,
      sessionContextRetention: '斷線立即清除模型工作階段上下文',
      localMemoryOnly: 'AIRI 本機端的原始音訊與畫面僅在記憶體中短暫存在',
      providerRetention: '已傳送至千問的資料可能進入保留一個月的服務日誌',
      regionBoundary: '中國內地 Endpoint 的資料不會跨地域或跨境傳輸',
      consentRetention: '上傳畫面可能進入保留一個月的服務日誌',
    },
  ])('qualifies local retention and discloses Provider retention and region for $locale', ({ source, localMemoryOnly, providerRetention, sessionContextRetention, regionBoundary, consentRetention }) => {
    expect(source).toContain(localMemoryOnly)
    expect(source).toContain(providerRetention)
    expect(source).toContain(sessionContextRetention)
    expect(source).toContain(regionBoundary)
    expect(source).toContain(consentRetention)
  })
})
