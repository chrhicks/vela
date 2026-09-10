import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.API_PROXY_TARGET
  const lanHost = env.VELA_LAN_HOST

  return {
    plugins: [react(), tailwindcss()],
    server: {
      ...(lanHost ? {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        allowedHosts: [lanHost],
      } : {}),
      ...(proxyTarget ? {
        proxy: {
          '/api': {
            target: proxyTarget,
            changeOrigin: true,
          },
        },
      } : {}),
    },
  }
})
