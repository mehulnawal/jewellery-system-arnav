import { createRequire } from "node:module";
import { join } from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { OAuth2Client } from "google-auth-library";

const require = createRequire(import.meta.url);
const scope = "https://www.googleapis.com/auth/cloud-platform";

// Explicit opt-in for machines authenticated with Firebase CLI but without ADC.
// No token or refresh token is written to disk or printed by this adapter.
export async function firebaseCliFirestore(projectId) {
  const authPath = process.env.FIREBASE_TOOLS_AUTH_PATH ||
    (process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib", "auth.js"));
  if (!authPath) throw new Error("Set FIREBASE_TOOLS_AUTH_PATH to the installed Firebase CLI auth.js file.");
  const auth = require(authPath);
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase CLI is not signed in. Run firebase login first.");
  const token = await auth.getAccessToken(account.tokens.refresh_token, [scope]);
  if (!token?.access_token) throw new Error("Firebase CLI did not provide an access token.");
  const client = new OAuth2Client();
  client.setCredentials({ access_token: token.access_token, expiry_date: token.expires_at });
  return new Firestore({ projectId, preferRest: true, authClient: client });
}
