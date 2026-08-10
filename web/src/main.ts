import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from '@/router'
import App from './App.vue'

// Element Plus 样式（按需加载由 unplugin-vue-components 处理组件，
// 基础样式仍需手动引入）
import 'element-plus/dist/index.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
