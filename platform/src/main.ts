import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import 'ant-design-vue/dist/reset.css'
import './styles/variables.css'
import './styles/base.css'

createApp(App).use(createPinia()).use(router).mount('#app')
