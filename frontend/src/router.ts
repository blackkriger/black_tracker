import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './lib/session';
import Login from './routes/Login.vue';
import Board from './routes/Board.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/board' },
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    { path: '/board', name: 'board', component: Board },
    { path: '/board/:short', name: 'project-board', component: Board },
  ],
});

// One gate for the whole app: nothing but the sign-in screen is public, and `/me` is asked once per page load rather than per route change.
router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.ready.value) await session.refresh();
  if (to.meta.public) {
    return session.me.value && to.name === 'login' ? { name: 'board' } : true;
  }
  if (!session.me.value) return { name: 'login', query: { next: to.fullPath } };
  return true;
});
