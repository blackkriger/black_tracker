import { createApp } from 'vue';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
// The one place another project's canon shows up: the wordmark on the sign-in screen.
import '@fontsource/cinzel/700.css';
import './styles/tracker.css';
import App from './App.vue';
import { router } from './router';

createApp(App).use(router).mount('#app');
