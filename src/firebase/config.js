import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const localEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
if (localEmulators && (!import.meta.env.DEV || !firebaseConfig.projectId?.startsWith('demo-')))
  throw new Error('Local emulators require a development build and a demo- project.');
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (localEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9298', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8180);
}
if (import.meta.env.DEV) console.info('[Firebase target]', {
  projectId: firebaseConfig.projectId,
  firestore: localEmulators ? '127.0.0.1:8180 (local rules)' : 'remote project (deployed rules)',
});
export const secondaryApp = () => {
  const existing = getApps().find(item => item.name === 'access-management');
  if (existing) return getApp('access-management');
  const secondary = initializeApp(firebaseConfig, 'access-management');
  if (localEmulators) connectAuthEmulator(getAuth(secondary), 'http://127.0.0.1:9298', { disableWarnings: true });
  return secondary;
};
export default app;
