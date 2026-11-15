import { useState } from "react";
import { VersionTag } from "./UpdatePrompt";
import { createRoom, joinRoom } from "../game/room";
import { getName, saveName } from "./name";

export default function Home({ uid, roomCode, notFound }: { uid: string; roomCode: string; notFound: boolean }) {
  const [name, setName] = useState(getName());
  const [code, setCode] = useState(roomCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(notFound ? "Ce salon n'existe pas." : "");

  const go = async (create: boolean) => {
    if (!name.trim()) return setErr("Choisis un pseudo.");
    setBusy(true);
    setErr("");
    saveName(name.trim());
    try {
      const c = create ? await createRoom(uid, name.trim()) : code.trim().toUpperCase();
      if (!create) await joinRoom(c, uid, name.trim());
      location.hash = `/${c}`;
    } catch (e) {
      setErr((e as Error).message.includes("n'existe") ? "Ce salon n'existe pas." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <div className="logo">
        <span className="hole" />
        <h1>Tokards</h1>
      </div>
      <p className="muted">Jeu de cartes multijoueur — table virtuelle</p>
      <div className="panel home-form">
        <label>
          Pseudo
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Ton pseudo" />
        </label>
        {!roomCode && (
          <button className="primary" disabled={busy} onClick={() => go(true)}>Créer un salon</button>
        )}
        <div className="row">
          <input value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" className="code-input" />
          <button disabled={busy || code.length !== 5} onClick={() => go(false)}>Rejoindre</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
      <p className="small"><VersionTag /></p>
    </div>
  );
}
