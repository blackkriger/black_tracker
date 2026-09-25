import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './lib/session';
import Login from './routes/Login.vue';
import Home from './routes/Home.vue';
import Board from './routes/Board.vue';
import Profile from './routes/Profile.vue';
import NotFound from './routes/NotFound.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The root decides where you belong: the board of the project you last had open, or an empty state when there are no projects yet.
    { path: '/', name: 'home', component: Home },
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    { path: '/p/:short', name: 'project-board', component: Board },
    { path: '/p/:short/b/:boardId', name: 'board', component: Board },
    { path: '/profile', name: 'profile', component: Profile },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
  ],
});

// One gate for the whole app: nothing but the sign-in screen is public, and `/me` is asked once per page load rather than per route change.
router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.ready.value) await session.refresh();
  if (to.meta.public) {
    return session.me.value && to.name === 'login' ? { name: 'home' } : true;
  }
  if (!session.me.value) return { name: 'login', query: { next: to.fullPath } };
  return true;
});
