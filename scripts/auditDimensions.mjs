import { readFile, writeFile } from "node:fs/promises";
import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { auditDimensions } from "../src/utils/dimensionAudit.js";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = option("input"), projectId = option("project"), output = option("output");
if (args.includes("--apply")) throw new Error("This audit is read-only. No apply/migration mode exists.");
let data, app;
try {
  if (input) data = JSON.parse(await readFile(input, "utf8"));
  else {
    if (!projectId) throw new Error("Pass --input=export.json or --project=PROJECT_ID. No writes are performed.");
    app = initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
    const db = getFirestore(app);
    data = Object.fromEntries(await Promise.all(["inventory", "purchases", "challans"].map(async (name) => {
      const snapshot = await db.collection(name).get();
      return [name, snapshot.docs.map((record) => ({ ...record.data(), id: record.id }))];
    })));
  }
  const report = { source: input || projectId, readOnly: true, ...auditDimensions(data) };
  const json = JSON.stringify(report, null, 2);
  if (output) await writeFile(output, json + "\n");
  console.log(json);
} finally { if (app) await deleteApp(app); }
