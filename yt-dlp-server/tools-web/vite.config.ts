import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Express phục vụ thư mục dist tại /tools, nên mọi asset phải có tiền tố /tools/.
export default defineConfig({
  base: '/tools/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // Mỗi tool là một chunk lazy riêng; cảnh báo sớm nếu chunk chung phình to.
    chunkSizeWarningLimit: 300
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001'
    }
  }
})
