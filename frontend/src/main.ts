import { mount } from 'svelte';
import '~/index.css';
import '~/App.css';
import App from './App.svelte';
import { cleanupLegacyCache } from '~/utils/cleanup';

// Remove legacy localStorage cache keys on startup
cleanupLegacyCache();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
