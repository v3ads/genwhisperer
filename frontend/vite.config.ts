import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Same-origin topology: in dev, proxy /api to the local backend (default :3001).
// In production the reverse proxy routes /api/* to the Node process, so the
// frontend always calls relative /api/... paths and cookies "just work".
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_API_TARGET || 'http://localhost:3001'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target, changeOrigin: true } },
    },
  }
})
