import { createSharedPerceptionOwnerProvider, createWebLockPerceptionOwnerProvider } from '@proj-airi/stage-ui/domains/perception'

export const productionPerceptionOwnerProvider = createSharedPerceptionOwnerProvider(
  createWebLockPerceptionOwnerProvider(navigator.locks),
)
