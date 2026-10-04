import { readFile, writeFile } from "node:fs/promises";
import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { auditDimensions } from "../src/utils/dimensionAudit.js";
import { identityFingerprint, initializeInventoryIdentities } from "./lib/initializeInventoryIdentities.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = option("input"), project = option("project"), output = option("output"), apply = args.includes("--apply");
if (args.includes("--help")) {
  console.log("Dry run: node scripts/initializeInventoryIdentities.mjs --input=export.json --output=plan.json\nEmulator dry run: --project=demo-inventory-rollout --output=plan.json (set FIRESTORE_EMULATOR_HOST)\nApply: --project=PROJECT --apply --expected-fingerprint=SHA256 --ack-guard-rules-deployed\nNon-emulator access additionally requires --allow-live --confirm-project=PROJECT. No business records are written. JSON exports can never be applied directly.");
  process.exit(0);
}
if (input && apply) throw new Error("JSON exports are read-only audit inputs, never an initialization source.");
if (!input && !project) throw new Error("Pass --input=export.json or an explicit --project=PROJECT.");
if (apply && (!option("expected-fingerprint") || !args.includes("--ack-guard-rules-deployed")))
  throw new Error("Apply requires a reviewed --expected-fingerprint and --ack-guard-rules-deployed.");
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!input && emulator && (!project.startsWith("demo-") || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(emulator)))
  throw new Error("Local initialization requires a demo- project and a loopback emulator host.");
if (!input && !emulator && (!args.includes("--allow-live") || option("confirm-project") !== project))
  throw new Error("Live access disabled. Use a JSON export or local emulator. A future approved live run requires --allow-live --confirm-project=PROJECT.");
let app;
try {
  let data, db;
  if (input) data = JSON.parse(await readFile(input, "utf8"));
  else {
    app = initializeApp({ projectId: project, ...(emulator ? {} : { credential: applicationDefault() }) });
    db = getFirestore(app);
    data = Object.fromEntries(await Promise.all(["inventory", "purchases", "challans"].map(async (name) => {
      const snapshot = await db.collection(name).get();
      return [name, snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }))];
    })));
  }
  if (!Array.isArray(data.inventory)) throw new Error("Export must include the complete inventory array, with each physical document id.");
  for (const name of ["purchases", "challans"]) if (data[name] !== undefined && !Array.isArray(data[name])) throw new Error(`${name} must be an array when supplied.`);
  const report = { source: input || project, mode: apply ? "apply-preflight" : "read-only", productionAuditRun: Boolean(!input && !emulator),
    ...auditDimensions(data), fingerprint: identityFingerprint(data.inventory) };
  // Always produce the audit before applying; an invalid audit never enables ready.
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (apply) {
    const result = await initializeInventoryIdentities(db, { expectedFingerprint: option("expected-fingerprint"), guardRulesAcknowledged: true });
    console.log(JSON.stringify({ initialization: result }, null, 2));
  }
} finally { if (app) await deleteApp(app); }
