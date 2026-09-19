import { createRouter, createWebHashHistory } from 'vue-router';

// 必须 hash 模式：子包以 file:// 加载，无服务器 rewrite，history 模式会白屏
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/Home.vue') },
    { path: '/about', name: 'about', component: () => import('./views/About.vue') },
  ],
});

export default router;
