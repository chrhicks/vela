import type { CaptureSettings } from './routes.js'

export function captureSettings(env: NodeJS.ProcessEnv): CaptureSettings | undefined {
  if (!env.VELA_CAPTURE_ENDPOINT && !env.VELA_CAPTURE_CAMERA_ID) return undefined
  if (!env.VELA_CAPTURE_ENDPOINT || !env.VELA_CAPTURE_CAMERA_ID?.trim()) {
    throw new Error('Capture requires an endpoint and a configured camera ID')
  }
  const endpoint = new URL(env.VELA_CAPTURE_ENDPOINT)
  if (endpoint.protocol !== 'http:' || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error('Invalid VELA_CAPTURE_ENDPOINT')
  }
  return { endpoint: endpoint.origin, cameraId: env.VELA_CAPTURE_CAMERA_ID.trim() }
}
