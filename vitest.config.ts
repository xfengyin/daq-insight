import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Vitest 配置：tests/ 目录下的 *.test.ts 均为 Node 环境单元测试
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'core'),
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
