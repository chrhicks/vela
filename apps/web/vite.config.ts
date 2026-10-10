import { defineConfig, loadEnv, type PreviewOptions, type ServerOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.API_PROXY_TARGET
  const lanHost = env.VELA_LAN_HOST

  const server: ServerOptions = {}
  // Preview inherits host, strict port, allowed hosts and proxy from server.
  const preview: PreviewOptions = {}

  if (lanHost) {
    server.host = '0.0.0.0'
    server.port = 5173
    server.strictPort = true
    server.allowedHosts = [lanHost]
    preview.port = 5173
  }

  if (proxyTarget) {
    server.proxy = { '/api': { target: proxyTarget, changeOrigin: true } }
  }

  return { plugins: [react(), tailwindcss()], server, preview }
})
