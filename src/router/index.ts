import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
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
