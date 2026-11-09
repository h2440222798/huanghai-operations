import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // 作品托管在子路径下，用 hash 路由避免服务器 rewrite 依赖
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'lobby',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/battle/:mode',
      name: 'battle',
      component: () => import('@/views/GameView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export default router
