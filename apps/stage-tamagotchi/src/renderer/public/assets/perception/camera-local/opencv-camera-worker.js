/* eslint-disable no-restricted-globals */
let cvPromise
let previousGrid

self.onmessage = async (event) => {
  const message = event.data
  if (message?.type === 'dispose') {
    previousGrid = undefined
    self.close()
    return
  }

  try {
    const { api: cv } = await loadOpenCv()
    if (message?.type === 'init') {
      self.postMessage({ type: 'ready', requestId: message.requestId, version: '4.13.0' })
      return
    }
    if (message?.type !== 'analyze' || !(message.imageData instanceof ImageData))
      throw new Error('opencv-worker-invalid-message')

    const metrics = analyze(cv, message.imageData, message.observedAt)
    self.postMessage({ type: 'result', requestId: message.requestId, metrics })
  }
  catch {
    self.postMessage({ type: 'error', requestId: message?.requestId, errorCode: 'opencv-worker-failed' })
  }
}

function loadOpenCv() {
  if (cvPromise)
    return cvPromise
  cvPromise = new Promise((resolve, reject) => {
    try {
      self.importScripts('./opencv-4.13.0.js')
      const candidate = self.cv
      if (!candidate)
        throw new Error('opencv-worker-runtime-missing')
      if (typeof candidate.then === 'function')
        candidate.then(api => resolve({ api }), reject)
      else
        resolve({ api: candidate })
    }
    catch (error) {
      reject(error)
    }
  })
  return cvPromise
}

function analyze(cv, imageData, observedAt) {
  const rgba = cv.matFromImageData(imageData)
  const gray = new cv.Mat()
  const grid = new cv.Mat()
  const laplacian = new cv.Mat()
  const mean = new cv.Mat()
  const stddev = new cv.Mat()
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
    cv.resize(gray, grid, new cv.Size(32, 18), 0, 0, cv.INTER_AREA)
    cv.Laplacian(gray, laplacian, cv.CV_64F)
    cv.meanStdDev(laplacian, mean, stddev)
    const meanLuminance = cv.mean(grid)[0]
    const laplacianVariance = stddev.doubleAt(0, 0) ** 2
    const currentGrid = new Uint8Array(grid.data)
    let visiblePixels = 0
    let changedPixels = 0
    for (let index = 0; index < currentGrid.length; index++) {
      const value = currentGrid[index]
      if (value > 5 && value < 250)
        visiblePixels += 1
      if (previousGrid && Math.abs(value - previousGrid[index]) >= 20)
        changedPixels += 1
    }
    const motionRatio = previousGrid ? changedPixels / currentGrid.length : 0
    previousGrid = currentGrid
    return {
      observedAt,
      meanLuminance,
      laplacianVariance,
      motionRatio,
      visiblePixelRatio: visiblePixels / currentGrid.length,
    }
  }
  finally {
    rgba.delete()
    gray.delete()
    grid.delete()
    laplacian.delete()
    mean.delete()
    stddev.delete()
  }
}
