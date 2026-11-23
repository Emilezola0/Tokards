import { lazy, Suspense, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ensureSignedIn } from "./firebase";
import { joinRoom, watchRoom } from "./game/room";
import type { Room } from "./game/types";
import Home from "./ui/Home";
import Lobby from "./ui/Lobby";

import { getName, rememberRoom } from "./ui/name";
import UpdatePrompt from "./ui/UpdatePrompt";
import Overlays from "./ui/Overlays";

// La table (plateau, animations, dé 3D…) n'est chargée qu'en entrant dans une partie.
const Table = lazy(() => import("./ui/Table"));

const codeFromHash = () => location.hash.replace(/^#\/?/, "").toUpperCase().slice(0, 5);

export default function App() {
  return (
    <>
      <Screen />
      <UpdatePrompt />
      <Overlays />
    </>
  );
}

function Screen() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState(codeFromHash());
  const [room, setRoom] = useState<Room | null | undefined>(undefined);

  useEffect(() => {
    ensureSignedIn().then(setUser).catch((e) => setError(`Connexion impossible : ${e.message}`));
    const onHash = () => setCode(codeFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!user || !code) return;
    setRoom(undefined);
    let joined = false;
    return watchRoom(
      code,
      (r) => {
        setRoom(r);
        // Rejoint automatiquement le salon ouvert par lien si on a déjà un pseudo.
        if (r && !r.players[user.uid] && !r.kicked?.includes(user.uid) && !joined && getName()) {
          joined = true;
          joinRoom(code, user.uid, getName()).catch((e) => setError(e.message));
        }
      },
      (e) => setError(e.message),
    );
  }, [user, code]);

  // Dans un salon : la table se télécharge en avance pour s'afficher tout de suite au lancement.
  const inRoom = !!room;
  useEffect(() => {
    if (inRoom) void import("./ui/Table");
  }, [inRoom]);

  if (error) return <div className="center"><p className="error">{error}</p><a href="#" onClick={() => setError("")}>Retour</a></div>;
  if (!user) return <div className="center muted">Connexion…</div>;
  if (!code || room === null || (room && !room.players[user.uid] && !getName()))
    return <Home uid={user.uid} roomCode={room ? code : ""} notFound={room === null && !!code} />;
  if (room?.kicked?.includes(user.uid))
    return (
      <div className="center">
        <p className="error">🚫 Tu as été exclu de ce salon par l'hôte.</p>
        <a href="#" onClick={() => (location.hash = "")}>Retour à l'accueil</a>
      </div>
    );
  if (room === undefined || !room.players[user.uid]) return <div className="center muted">Chargement du salon…</div>;
  rememberRoom(room.code);
  if (room.status === "lobby") return <Lobby room={room} uid={user.uid} />;
  return (
    <Suspense fallback={<div className="center muted">Chargement de la table…</div>}>
      <Table room={room} uid={user.uid} />
    </Suspense>
  );
}
