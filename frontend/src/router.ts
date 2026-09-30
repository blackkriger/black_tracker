import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './lib/session';
import Login from './routes/Login.vue';
import Home from './routes/Home.vue';

const Board = () => import('./routes/Board.vue');
const Profile = () => import('./routes/Profile.vue');
const NotFound = () => import('./routes/NotFound.vue');
const SettingsIndex = () => import('./routes/settings/Index.vue');
const SettingsProfile = () => import('./routes/settings/Profile.vue');
const SettingsApi = () => import('./routes/settings/Api.vue');
const SettingsProject = () => import('./routes/settings/Project.vue');
const SettingsNewProject = () => import('./routes/settings/NewProject.vue');
const SettingsTags = () => import('./routes/settings/Tags.vue');
const SettingsUsers = () => import('./routes/settings/Users.vue');
const Join = () => import('./routes/Join.vue');
const Dashboard = () => import('./routes/Dashboard.vue');
const Analytics = () => import('./routes/Analytics.vue');

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/me', name: 'me', component: Dashboard },
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    { path: '/join/:token', name: 'join', component: Join, meta: { public: true } },
    { path: '/:short([A-Z][A-Z0-9]*)', name: 'project-board', component: Board },
    { path: '/:short([A-Z][A-Z0-9]*)/:slug', name: 'board', component: Board },
    { path: '/:short([A-Z][A-Z0-9]*)/:slug/:key', name: 'issue', component: Board },
    { path: '/profile', name: 'profile', component: Profile },
    { path: '/calendar', redirect: { name: 'me', query: { calendar: 'full' } } },
    { path: '/analytics', name: 'analytics', component: Analytics },
    { path: '/settings', name: 'settings', component: SettingsIndex },
    { path: '/settings/profile', name: 'settings-profile', component: SettingsProfile },
    { path: '/settings/api', name: 'settings-api', component: SettingsApi },
    { path: '/settings/new', name: 'settings-new-project', component: SettingsNewProject },
    { path: '/settings/:short([A-Z][A-Z0-9]*)', name: 'settings-project', component: SettingsProject },
    { path: '/settings/tags', name: 'settings-tags', component: SettingsTags },
    { path: '/settings/users', name: 'settings-users', component: SettingsUsers },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.ready.value) await session.refresh();
  if (to.meta.public) {
    return session.me.value && to.name === 'login' ? { name: 'home' } : true;
  }
  if (!session.me.value) {
    return to.fullPath === '/'
      ? { name: 'login' }
      : { name: 'login', query: { next: to.fullPath } };
  }
  const roleless = !session.me.value.isAdmin && !session.me.value.role;
  if (roleless && to.name !== 'profile') return { name: 'profile' };
  return true;
});

// After a deploy old tabs ask for chunk files that are gone; reload once, never loop.
const RETRIED = 'tracker:chunk-retry';
router.onError((error, to) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!/dynamically imported module|Importing a module script failed/i.test(message)) return;
  try {
    if (sessionStorage.getItem(RETRIED) === to.fullPath) return;
    sessionStorage.setItem(RETRIED, to.fullPath);
  } catch {}
  window.location.assign(to.fullPath);
});
router.afterEach(() => {
  try {
    sessionStorage.removeItem(RETRIED);
  } catch {}
});
