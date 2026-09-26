import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const port = Number(env.WEB_PORT || 5173)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WEB_PORT')
  return {
    plugins: [react()],
    server: { host: env.WEB_HOST || '127.0.0.1', port, strictPort: true },
  }
})
