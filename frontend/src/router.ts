import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './lib/session';
import Login from './routes/Login.vue';
import Home from './routes/Home.vue';
import Board from './routes/Board.vue';
import Profile from './routes/Profile.vue';
import NotFound from './routes/NotFound.vue';
import SettingsIndex from './routes/settings/Index.vue';
import SettingsProject from './routes/settings/Project.vue';
import SettingsNewProject from './routes/settings/NewProject.vue';
import SettingsTags from './routes/settings/Tags.vue';
import SettingsUsers from './routes/settings/Users.vue';
import Join from './routes/Join.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The root decides where you belong: the board of the project you last had open, or an empty state when there are no projects yet.
    { path: '/', name: 'home', component: Home },
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    // The far end of an invite link: open to whoever holds it, and the only way an account is ever born in the browser.
    { path: '/join/:token', name: 'join', component: Join, meta: { public: true } },
    // A project key is upper-case by its own rule and every page of ours is lower-case, so the two can share the root without a marker between them.
    { path: '/:short([A-Z][A-Z0-9]*)', name: 'project-board', component: Board },
    { path: '/:short([A-Z][A-Z0-9]*)/:slug', name: 'board', component: Board },
    // The same board with one of its issues open over it, so a card can be linked to.
    { path: '/:short([A-Z][A-Z0-9]*)/:slug/:key', name: 'issue', component: Board },
    { path: '/profile', name: 'profile', component: Profile },
    { path: '/settings', name: 'settings', component: SettingsIndex },
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
