import type { PerceptionSessionController } from '../../domains/perception'
import type { ProductionScreenCaptureAdapter } from './screen-capture-lifecycle'

import { ProductionScreenCaptureLifecycle } from './screen-capture-lifecycle'

export class ProductionCameraCaptureLifecycle extends ProductionScreenCaptureLifecycle {
  constructor(session: PerceptionSessionController, adapter: ProductionScreenCaptureAdapter) {
    super(session, adapter, 'camera')
  }
}
