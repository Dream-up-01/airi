export interface CameraFrameLease<TFrame> {
  frame: TFrame
  capturedAt: number
  release: () => void
}

export interface CameraAnalyzerResult<TEvidence> {
  status: 'completed' | 'timed-out' | 'failed' | 'dropped' | 'disposed'
  evidence?: TEvidence
  errorCode?: string
}

export interface LatestCameraAnalyzerOptions<TFrame, TEvidence> {
  timeoutMs: number
  analyze: (frame: TFrame, capturedAt: number, signal: AbortSignal) => Promise<TEvidence>
  onResult: (result: CameraAnalyzerResult<TEvidence>) => void
}

/** One in-flight analysis plus one replaceable latest-frame slot. */
export function createLatestCameraAnalyzer<TFrame, TEvidence>(options: LatestCameraAnalyzerOptions<TFrame, TEvidence>) {
  let running = false
  let disposed = false
  let pending: CameraFrameLease<TFrame> | undefined
  let activeController: AbortController | undefined

  function submit(lease: CameraFrameLease<TFrame>) {
    if (disposed) {
      lease.release()
      options.onResult({ status: 'disposed' })
      return
    }
    if (running) {
      if (pending) {
        pending.release()
        options.onResult({ status: 'dropped' })
      }
      pending = lease
      return
    }
    void run(lease)
  }

  async function run(lease: CameraFrameLease<TFrame>) {
    running = true
    const controller = new AbortController()
    activeController = controller
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort('camera-analyzer-timeout')
    }, options.timeoutMs)
    try {
      const evidence = await options.analyze(lease.frame, lease.capturedAt, controller.signal)
      options.onResult(timedOut ? { status: 'timed-out', errorCode: 'camera-analyzer-timeout' } : { status: 'completed', evidence })
    }
    catch (error) {
      options.onResult({
        status: timedOut ? 'timed-out' : 'failed',
        errorCode: timedOut ? 'camera-analyzer-timeout' : normalizeErrorCode(error),
      })
    }
    finally {
      clearTimeout(timeout)
      lease.release()
      activeController = undefined
      running = false
      const next = pending
      pending = undefined
      if (next && !disposed)
        void run(next)
      else
        next?.release()
    }
  }

  function dispose() {
    if (disposed)
      return
    disposed = true
    activeController?.abort('camera-analyzer-disposed')
    pending?.release()
    pending = undefined
  }

  return {
    submit,
    dispose,
    isBusy: () => running,
  }
}

function normalizeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9][a-z0-9:-]*$/u.test(error.message))
    return error.message.slice(0, 80)
  return 'camera-analyzer-failed'
}
