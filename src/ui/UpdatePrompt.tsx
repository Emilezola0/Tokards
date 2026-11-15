import { useEffect, useState } from "react";

declare const __APP_VERSION__: { version: string; commit: string; build: string; date: string };
export const APP_VERSION = __APP_VERSION__;

const CHECK_EVERY = 60_000;

async function fetchRemote(): Promise<typeof APP_VERSION | null> {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as typeof APP_VERSION;
  } catch {
    return null;
  }
}

/** Recharge le site en contournant le cache (équivalent d'un Ctrl+F5). */
async function hardReload() {
  try {
    await fetch(`./index.html?t=${Date.now()}`, { cache: "reload" });
    await fetch("./", { cache: "reload" });
  } catch {
    /* hors ligne : on recharge quand même */
  }
  location.reload();
}

/** Vérifie régulièrement si une nouvelle version est en ligne et propose de mettre à jour. */
export default function UpdatePrompt() {
  const [remote, setRemote] = useState<typeof APP_VERSION | null>(null);
  const [later, setLater] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return; // en dev, Vite recharge déjà tout seul
    const check = async () => {
      const v = await fetchRemote();
      if (v && v.build !== APP_VERSION.build) setRemote(v);
    };
    void check();
    const id = setInterval(check, CHECK_EVERY);
    const onVis = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!remote || later === remote.build) return null;
  return (
    <div className="update-pop panel" role="alertdialog" aria-label="Mise à jour disponible">
      <div>
        <strong>✨ Nouvelle version disponible</strong>
        <div className="small muted">
          v{APP_VERSION.version} ({APP_VERSION.commit}) → v{remote.version} ({remote.commit})
        </div>
        <div className="small muted">La partie en cours est conservée : tu reviens à la même table.</div>
      </div>
      <div className="row">
        <button className="primary" onClick={() => void hardReload()}>Mettre à jour</button>
        <button className="ghost" onClick={() => setLater(remote.build)}>Plus tard</button>
      </div>
    </div>
  );
}

export function VersionTag() {
  return (
    <span className="version-tag" title={`Build du ${new Date(APP_VERSION.date).toLocaleString("fr-FR")}`}>
      v{APP_VERSION.version} · {APP_VERSION.commit}
    </span>
  );
}
