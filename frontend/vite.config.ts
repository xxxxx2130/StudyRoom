import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyRequest, request) => {
            if (request.headers.host) {
              proxyRequest.setHeader('x-forwarded-host', request.headers.host)
            }
          })
        },
      },
    },
  },
})
