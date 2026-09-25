import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './lib/session';
import Login from './routes/Login.vue';
import Home from './routes/Home.vue';
import Board from './routes/Board.vue';
import Profile from './routes/Profile.vue';
import NotFound from './routes/NotFound.vue';
import AdminIndex from './routes/admin/Index.vue';
import AdminProject from './routes/admin/Project.vue';
import AdminNewProject from './routes/admin/NewProject.vue';
import AdminTags from './routes/admin/Tags.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The root decides where you belong: the board of the project you last had open, or an empty state when there are no projects yet.
    { path: '/', name: 'home', component: Home },
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    { path: '/p/:short', name: 'project-board', component: Board },
    { path: '/p/:short/b/:boardId', name: 'board', component: Board },
    { path: '/profile', name: 'profile', component: Profile },
    { path: '/admin', name: 'admin', component: AdminIndex, meta: { admin: true } },
    { path: '/admin/new', name: 'admin-new-project', component: AdminNewProject, meta: { admin: true } },
    { path: '/admin/p/:short', name: 'admin-project', component: AdminProject, meta: { admin: true } },
    { path: '/admin/tags', name: 'admin-tags', component: AdminTags, meta: { admin: true } },
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
  // `next` rides along only when it says something the root does not already decide.
  if (!session.me.value) {
    return to.fullPath === '/'
      ? { name: 'login' }
      : { name: 'login', query: { next: to.fullPath } };
  }
  // The admin screens are the only place a member is turned away rather than shown less.
  if (to.meta.admin && !session.me.value.isAdmin) return { name: 'home' };
  return true;
});
