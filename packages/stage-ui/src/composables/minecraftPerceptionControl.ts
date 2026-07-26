import type { InjectionKey } from 'vue'

import { inject, provide } from 'vue'

export interface MinecraftPerceptionControl {
  start: (consentConfirmed: boolean) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
}

const minecraftPerceptionControlKey: InjectionKey<MinecraftPerceptionControl> = Symbol('minecraft-perception-control')

export function provideMinecraftPerceptionControl(control: MinecraftPerceptionControl): void {
  provide(minecraftPerceptionControlKey, control)
}

export function useMinecraftPerceptionControl(): MinecraftPerceptionControl | undefined {
  return inject(minecraftPerceptionControlKey, undefined)
}
