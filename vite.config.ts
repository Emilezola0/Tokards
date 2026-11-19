import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Version affichée et comparée par le site pour proposer la mise à jour.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };
let commit = "dev";
try {
  commit = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  /* pas de git : version de dev */
}
const build = `${pkg.version}+${commit}.${Date.now().toString(36)}`;
const VERSION = { version: pkg.version, commit, build, date: new Date().toISOString() };

/** Écrit version.json à côté du site : le client le relit pour savoir si une nouvelle version est en ligne. */
function versionFile(): Plugin {
  return {
    name: "tokards-version",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(VERSION) });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), versionFile()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Firebase et React changent rarement : dans leurs propres fichiers, le navigateur les garde en cache
        // d'une version du site à l'autre et ne retélécharge que le code du jeu.
        manualChunks(id) {
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) return "firebase";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
        },
      },
    },
  },
});
