import { useEffect, useState } from "react";
import { VersionTag } from "./UpdatePrompt";
import { createRoom, joinRoom, peekRoom } from "../game/room";
import { codeFrom, forgetRoom, getName, getRecentRooms, saveName } from "./name";
import type { Room } from "../game/types";

/** Il y a combien de temps, en clair. */
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
};
import Takedown from "./Takedown";

export default function Home({ uid, roomCode, notFound }: { uid: string; roomCode: string; notFound: boolean }) {
  const [name, setName] = useState(getName());
  const [code, setCode] = useState(roomCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(notFound ? "Ce salon n'existe pas." : "");
  // Salons récents encore ouverts, pour y revenir en un clic.
  const [recent, setRecent] = useState<{ code: string; at: number; room: Room }[]>([]);
  useEffect(() => {
    if (roomCode) return;
    let live = true;
    Promise.all(getRecentRooms().map(async (r) => ({ ...r, room: await peekRoom(r.code).catch(() => null) }))).then((list) => {
      for (const r of list) if (!r.room || r.room.status === "ended" || r.room.kicked?.includes(uid)) forgetRoom(r.code);
      if (live) setRecent(list.filter((r): r is { code: string; at: number; room: Room } => !!r.room && r.room.status !== "ended" && !r.room.kicked?.includes(uid)));
    });
    return () => void (live = false);
  }, [roomCode, uid]);

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
          <input
            value={name}
            maxLength={20}
            autoFocus={!name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && (code.length === 5 ? go(false) : !roomCode && go(true))}
            placeholder="Ton pseudo"
          />
        </label>
        {!roomCode && (
          <button className="primary" disabled={busy} onClick={() => go(true)}>Créer un salon</button>
        )}
        <div className="row">
          <input
            value={code}
            onChange={(e) => setCode(codeFrom(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && code.length === 5 && !busy && go(false)}
            placeholder="CODE ou lien"
            title="Tape le code ou colle le lien d'invitation"
            className="code-input"
          />
          <button disabled={busy || code.length !== 5} onClick={() => go(false)}>Rejoindre</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
      {recent.length > 0 && (
        <div className="panel recent-rooms">
          <b className="small">↩ Reprendre</b>
          {recent.map(({ code: c, at, room }) => {
            const others = Object.values(room.players).filter((p) => p.uid !== uid).map((p) => p.name);
            return (
              <button key={c} className="recent-room" disabled={busy} onClick={() => {
                if (!name.trim()) return setErr("Choisis un pseudo.");
                saveName(name.trim());
                location.hash = `/${c}`;
              }}>
                <span className="code">{c}</span>
                <span className="recent-info">
                  <span>{room.status === "playing" ? "🎲 Partie en cours" : "🛋️ Salon"}{room.hostUid === uid ? " · tu es l'hôte" : ""}</span>
                  <span className="muted small">{others.length ? `avec ${others.slice(0, 3).join(", ")}${others.length > 3 ? "…" : ""}` : "seul pour l'instant"} · {ago(at)}</span>
                </span>
                <span className="recent-go">➜</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="small"><VersionTag /></p>
      <Takedown />
    </div>
  );
}
