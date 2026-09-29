import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './lib/session';
import Login from './routes/Login.vue';
import Home from './routes/Home.vue';

// The two screens a visit starts on ride in the first bundle; every other screen, and the
// editor, the charts and the readers it pulls in, is fetched the first time it is opened.
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
    // The root decides where you belong: the board of the project you last had open, or an empty state when there are no projects yet.
    { path: '/', name: 'home', component: Home },
    // Your own page: your issues and your starred ones, over a calendar folded to three months.
    { path: '/me', name: 'me', component: Dashboard },
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    // The far end of an invite link: open to whoever holds it, and the only way an account is ever born in the browser.
    { path: '/join/:token', name: 'join', component: Join, meta: { public: true } },
    // A project key is upper-case by its own rule and every page of ours is lower-case, so the two can share the root without a marker between them.
    { path: '/:short([A-Z][A-Z0-9]*)', name: 'project-board', component: Board },
    { path: '/:short([A-Z][A-Z0-9]*)/:slug', name: 'board', component: Board },
    // The same board with one of its issues open over it, so a card can be linked to.
    { path: '/:short([A-Z][A-Z0-9]*)/:slug/:key', name: 'issue', component: Board },
    { path: '/profile', name: 'profile', component: Profile },
    // The calendar is your own page with its year opened, and its old address still leads there.
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
  // No role is no access: until someone hands one out, the profile is the whole of the tracker.
  const roleless = !session.me.value.isAdmin && !session.me.value.role;
  if (roleless && to.name !== 'profile') return { name: 'profile' };
  return true;
});

// A screen is fetched the first time it is opened, and a deploy replaces those files: a tab
// opened before it still names the old ones and the fetch fails. The page is then loaded
// afresh at the address it was going to — once, so a file that is truly missing cannot loop.
const RETRIED = 'tracker:chunk-retry';
router.onError((error, to) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!/dynamically imported module|Importing a module script failed/i.test(message)) return;
  try {
    if (sessionStorage.getItem(RETRIED) === to.fullPath) return;
    sessionStorage.setItem(RETRIED, to.fullPath);
  } catch {
    // Without storage there is no way to tell a second failure from the first; try once anyway.
  }
  window.location.assign(to.fullPath);
});
router.afterEach(() => {
  try {
    sessionStorage.removeItem(RETRIED);
  } catch {
    // Nothing was kept, so nothing needs clearing.
  }
});
