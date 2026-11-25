// Demandes de changement saisies dans l'Atelier (collection Firestore `requests`).
// Utilise la connexion `firebase login` de cette machine (accès propriétaire du projet) : rien n'est public.
//
//   node scripts/changements.mjs                 → demandes ouvertes
//   node scripts/changements.mjs tout            → toutes les demandes
//   node scripts/changements.mjs fait <id> "réponse"     → marque une demande comme faite
//   node scripts/changements.mjs refuse <id> "raison"    → marque une demande comme refusée
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const auth = require("firebase-tools/lib/auth.js");
const PROJECT = "tokards-b174f";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function token() {
  const acc = auth.getProjectDefaultAccount(process.cwd()) ?? auth.getGlobalDefaultAccount();
  if (!acc?.tokens?.refresh_token) throw new Error("Pas connecté : lance `npx firebase login`.");
  const t = await auth.getAccessToken(acc.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]);
  return t.access_token;
}

/** Valeur Firestore REST → JS. */
const val = (v) =>
  v == null ? null
  : "stringValue" in v ? v.stringValue
  : "integerValue" in v ? Number(v.integerValue)
  : "doubleValue" in v ? v.doubleValue
  : "booleanValue" in v ? v.booleanValue
  : "timestampValue" in v ? v.timestampValue
  : "nullValue" in v ? null
  : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, val(x)]))
  : "arrayValue" in v ? (v.arrayValue.values ?? []).map(val)
  : v;

async function call(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...init.headers } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function list(all) {
  const out = [];
  let page = "";
  do {
    const r = await call(`/requests?pageSize=300${page ? `&pageToken=${page}` : ""}`);
    for (const d of r.documents ?? []) out.push({ id: d.name.split("/").pop(), ...val({ mapValue: { fields: d.fields } }) });
    page = r.nextPageToken ?? "";
  } while (page);
  const shown = out.filter((x) => all || x.status === "ouvert").sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (!shown.length) return console.log(all ? "Aucune demande." : "Aucune demande ouverte.");
  for (const x of shown) {
    console.log(`\n[${x.id}] ${x.status.toUpperCase()} · ${x.card} « ${x.cardName} » · par ${x.name} · ${x.at ?? ""}`);
    console.log(`  ${String(x.text).replace(/\n/g, "\n  ")}`);
    if (x.reply) console.log(`  ↳ ${x.reply}`);
  }
}

async function close(id, status, reply) {
  if (!id) throw new Error("Donne l'identifiant de la demande.");
  const q = "updateMask.fieldPaths=status&updateMask.fieldPaths=reply&updateMask.fieldPaths=doneAt&currentDocument.exists=true";
  await call(`/requests/${id}?${q}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: { status: { stringValue: status }, reply: { stringValue: reply ?? "" }, doneAt: { timestampValue: new Date().toISOString() } } }),
  });
  console.log(`Demande ${id} : ${status}.`);
}

const [cmd, id, ...rest] = process.argv.slice(2);
try {
  if (cmd === "fait") await close(id, "fait", rest.join(" "));
  else if (cmd === "refuse") await close(id, "refusé", rest.join(" "));
  else await list(cmd === "tout");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
