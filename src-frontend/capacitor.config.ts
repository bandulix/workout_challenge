import type { CapacitorConfig } from '@capacitor/cli';

// Android shell around the existing PWA (see README "Android app").
// The bundled web build talks to the production backend over HTTPS -
// baked in at build time with REACT_APP_BACKEND_URL - while the WebView
// origin is https://localhost, which the backend's HOSTS env must allow
// (CORS with credentials).
const config: CapacitorConfig = {
  appId: 'com.bandulix.workoutchallenge',
  appName: 'Workout Challenge',
  webDir: 'build',
  android: {
    allowMixedContent: false,
  },
};

export default config;
