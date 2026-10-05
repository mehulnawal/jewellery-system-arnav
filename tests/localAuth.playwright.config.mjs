import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'.',testMatch:'localAuth.ui.spec.mjs',workers:1,timeout:60000,
 use:{baseURL:'http://127.0.0.1:4176',channel:'chrome',screenshot:'only-on-failure'},
 expect:{timeout:15000},
 webServer:{command:'npx vite --mode emulator --host 127.0.0.1 --port 4176 --strictPort',url:'http://127.0.0.1:4176',cwd:'..'},
});
