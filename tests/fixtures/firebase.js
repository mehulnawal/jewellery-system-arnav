import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { testUser } from "./auth.jsx";
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
const resetMode = localStorage.getItem('test-reset-mode') === 'true';
const app = initializeApp({ projectId: resetMode ? 'demo-reset-local' : 'demo-jewellery-ui', apiKey: "demo-test-key", appId: "demo-test-app" });
export const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", resetMode ? 8280 : 8180, { mockUserToken: { sub: testUser.uid, user_id: testUser.uid } });
export const auth = getAuth(app);
if(resetMode){connectAuthEmulator(auth,'http://127.0.0.1:9299',{disableWarnings:true});connectFunctionsEmulator(getFunctions(app),'127.0.0.1',5101);}
export {signInWithEmailAndPassword} from 'firebase/auth';
export const secondaryApp = () => app;
export default app;
export { disableNetwork, enableNetwork } from "firebase/firestore";
