// Convertit data/images/* en public/cards/<ID>.webp (480 px de large) pour le site.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const src = path.join(root, "data", "images");
const out = path.join(root, "public", "cards");
fs.mkdirSync(out, { recursive: true });

let n = 0;
for (const f of fs.readdirSync(src)) {
  const id = path.parse(f).name;
  const dest = path.join(out, `${id}.webp`);
  if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs > fs.statSync(path.join(src, f)).mtimeMs) continue;
  try {
    await sharp(path.join(src, f), { failOn: "none" })
      .resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toFile(dest);
    n++;
  } catch (e) {
    console.warn(`⚠ ${f} illisible (${e.message}) : image par défaut utilisée`);
  }
}
console.log(`${n} images converties dans public/cards`);
