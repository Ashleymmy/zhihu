import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { vReveal } from '@zhihu-koc/shared-components'
import { createAppRouter } from './router'

const app = createApp(App)
app.use(createPinia())
app.use(createAppRouter())
app.directive('reveal', vReveal)
app.mount('#app')
