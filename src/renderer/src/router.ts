import { createRouter, createWebHashHistory } from 'vue-router'
import OverviewView from './views/OverviewView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'overview', component: OverviewView },
    // 仓库路径放在 query 里，避免反斜杠和中文影响路由匹配
    { path: '/repo', name: 'repo', component: () => import('./views/RepoView.vue') }
  ]
})
