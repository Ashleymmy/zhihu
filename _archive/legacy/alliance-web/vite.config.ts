import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
        imports: ['vue', 'vue-router', 'pinia'],
        dts: 'src/types/auto-imports.d.ts',
      }),
      Components({
        resolvers: [ElementPlusResolver()],
        dts: 'src/types/components.d.ts',
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // 本地开发代理：避免 CORS，所有 /api 请求转发到知乎服务器
        // 生产环境须通过 BFF 后端，永远不要在生产直连 open.zhihu.com
        '/api': {
          target: 'https://open.zhihu.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      // Vitest 配置（docs/05-测试文档.md）
      globals: true,
      // jsdom 仅 Vue 组件测试需要；纯逻辑测试用 node 环境即可
      // 写 Vue 组件测试时再改回 'jsdom'（需先 npm install jsdom）
      environment: 'node',
      setupFiles: ['src/test/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        thresholds: {
          // 分层覆盖率下限（docs/05-测试文档.md §3.1）
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        include: ['src/**/*.ts', 'src/**/*.vue'],
        exclude: [
          'src/types/**',
          'src/test/**',
          'src/main.ts',
          'src/App.vue',
          '**/*.d.ts',
        ],
      },
      // 绝不允许未处理的请求穿透到真实 API（docs/05-测试文档.md §2.1）
      // onUnhandledRequest: 'error' 在 MSW setup 中配置
    },
  }
})
