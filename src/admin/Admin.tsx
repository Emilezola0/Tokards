// L'Atelier : espace d'édition du site (#/admin), réservé à l'équipe connectée avec Google.
import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { CONTENT, applyContent, assetKeys, dropUnused, loadAsset, type Content } from "../data/overrides";
import { DECKS } from "../data/cards";
import {
  REQ_LABEL, adminDb, claimOwner, useRequests, type ReqStatus, hasOwner, joinWithInvite, login, logout, ROLE_LABEL, watchContent, watchMember, watchUser, type Member,
} from "./api";
import { ToastHost } from "./bits";
import CardsTab, { RequestList } from "./CardsTab";
import DecksTab from "./DecksTab";
import SoundsTab from "./SoundsTab";
import TeamTab, { HistoryTab } from "./TeamTab";
import "./admin.css";

type Tab = "cards" | "decks" | "sounds" | "changes" | "team" | "history";
const TABS: { id: Tab; icon: string; label: string; sub: string }[] = [
  { id: "cards", icon: "🃏", label: "Cartes", sub: "Textes, images, voix" },
  { id: "decks", icon: "📦", label: "Decks", sub: "Infos, dos, composition" },
  { id: "sounds", icon: "🔊", label: "Sons", sub: "Effets sonores du jeu" },
  { id: "changes", icon: "🛠", label: "Changements", sub: "Effets à programmer" },
  { id: "team", icon: "👥", label: "Équipe", sub: "Membres et invitations" },
  { id: "history", icon: "📜", label: "Historique", sub: "Qui a changé quoi" },
];

export default function Admin({ invite }: { invite: string }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  useEffect(() => watchUser(setUser), []);
  useEffect(() => {
    if (!user) return setMember(user === null ? null : undefined);
    setMember(undefined);
    return watchMember(user.uid, setMember);
  }, [user]);

  return (
    <ToastHost>
      <div className="adm">
        {user === undefined || (user && member === undefined) ? (
          <Gate><p className="muted">Chargement…</p></Gate>
        ) : !user ? (
          <SignIn invite={invite} />
        ) : !member ? (
          <NotMember user={user} invite={invite} />
        ) : (
          <Workspace user={user} member={member} />
        )}
      </div>
    </ToastHost>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm-gate">
      <div className="adm-gate-card">
        <div className="adm-brand big"><span className="hole" /><span>Tokards <em>Atelier</em></span></div>
        {children}
        <a className="adm-back" href="#">← Retour au jeu</a>
      </div>
    </div>
  );
}

function SignIn({ invite }: { invite: string }) {
  const [err, setErr] = useState("");
  return (
    <Gate>
      {invite ? (
        <p>🎉 Tu as été invité·e à rejoindre l'équipe qui édite Tokards. Connecte-toi avec Google pour accepter.</p>
      ) : (
        <p className="muted">L'espace pour modifier les cartes, les decks, les images et les sons du jeu. Réservé à l'équipe.</p>
      )}
      <button className="adm-google" onClick={() => login().catch((e) => setErr(loginError(e)))}>
        <GoogleIcon /> Se connecter avec Google
      </button>
      {err && <p className="error">{err}</p>}
    </Gate>
  );
}

const loginError = (e: { code?: string; message?: string }) =>
  e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request"
    ? "Connexion annulée."
    : e.code === "auth/operation-not-allowed"
      ? "La connexion Google n'est pas encore activée sur le projet Firebase (Authentication → Sign-in method → Google)."
      : e.code === "auth/unauthorized-domain"
        ? "Ce site n'est pas autorisé pour la connexion : ajoute son domaine dans Firebase (Authentication → Settings → Authorized domains)."
        : `Connexion impossible : ${e.message ?? e.code}`;

function NotMember({ user, invite }: { user: User; invite: string }) {
  const [ownerFree, setOwnerFree] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    hasOwner().then((h) => setOwnerFree(!h)).catch(() => setOwnerFree(false));
  }, []);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      if (invite) history.replaceState(null, "", "#/admin");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Gate>
      <p>Connecté·e en tant que <b>{user.displayName ?? user.email}</b>.</p>
      {invite ? (
        <button className="primary big" disabled={busy} onClick={run(() => joinWithInvite(invite))}>✔ Rejoindre l'équipe</button>
      ) : ownerFree ? (
        <>
          <p className="muted small">Personne ne gère encore l'Atelier. Le premier à se connecter en devient le propriétaire : c'est lui qui invitera les autres.</p>
          <button className="primary big" disabled={busy} onClick={run(claimOwner)}>👑 Devenir propriétaire</button>
        </>
      ) : ownerFree === false ? (
        <p className="muted">Tu n'as pas encore accès à l'Atelier. Demande un <b>lien d'invitation</b> au propriétaire.</p>
      ) : (
        <p className="muted">Vérification…</p>
      )}
      {err && <p className="error">{err}</p>}
      <button className="adm-link" onClick={() => logout()}>Changer de compte</button>
    </Gate>
  );
}

/** Garde le contenu de l'Atelier à jour en direct (modifs des autres membres) et charge les fichiers. */
function useLiveContent() {
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState("");
  const loaded = useRef<Record<string, number>>({});
  useEffect(
    () =>
      watchContent(
        async (c: Content) => {
          applyContent(c);
          dropUnused(c);
          setRev((r) => r + 1);
          const keys = assetKeys(c);
          for (const k of Object.keys(loaded.current)) if (!keys[k]) delete loaded.current[k];
          const todo = Object.entries(keys).filter(([k, at]) => loaded.current[k] !== at);
          await Promise.all(todo.map(([k, at]) => loadAsset(adminDb, k, at).then(() => void (loaded.current[k] = at)).catch(() => {})));
          if (todo.length) setRev((r) => r + 1);
        },
        (e) => setErr(e.message),
      ),
    [],
  );
  return { rev, err };
}

function Workspace({ user, member }: { user: User; member: Member }) {
  const [tab, setTab] = useState<Tab>("cards");
  const { rev, err } = useLiveContent();
  const edited = Object.keys(CONTENT.cards ?? {}).length + Object.keys(CONTENT.decks ?? {}).length + Object.keys(CONTENT.sfx ?? {}).length;
  return (
    <div className="adm-shell">
      <header className="adm-top">
        <a className="adm-brand" href="#/admin"><span className="hole small-hole" /><span>Tokards <em>Atelier</em></span></a>
        <span className="adm-top-info small muted">
          {edited ? `${edited} élément${edited > 1 ? "s" : ""} modifié${edited > 1 ? "s" : ""}` : "Contenu d'origine"} · {DECKS.length} decks
        </span>
        <span className="grow" />
        <a className="adm-top-link" href="#" title="Les modifications s'appliquent au prochain chargement du jeu">🎮 Voir le jeu</a>
        <span className="adm-me">
          {user.photoURL ? <img className="adm-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <span className="adm-avatar">{(user.displayName ?? "?")[0]}</span>}
          <span className="adm-me-txt">
            <b>{member.name}</b>
            <span className="small muted">{ROLE_LABEL[member.role]}</span>
          </span>
          <button className="adm-link" onClick={() => logout()} title="Se déconnecter de l'Atelier (pas du jeu)">Déconnexion</button>
        </span>
      </header>
      <nav className="adm-nav">
        {TABS.map((t) => (
          <button key={t.id} className={`adm-nav-btn ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            <span className="adm-nav-icon">{t.icon}</span>
            <span className="adm-nav-txt">
              <b>{t.label}</b>
              <span>{t.sub}</span>
            </span>
          </button>
        ))}
        <div className="adm-nav-foot small muted">
          Les changements sont visibles par tous les joueurs au prochain chargement du site. Les parties en cours ne changent pas.
        </div>
      </nav>
      <main className="adm-main">
        {err && <p className="adm-pill bad">Lecture du contenu impossible : {err}</p>}
        {tab === "cards" && <CardsTab rev={rev} />}
        {tab === "decks" && <DecksTab rev={rev} />}
        {tab === "sounds" && <SoundsTab rev={rev} />}
        {tab === "changes" && <ChangesTab />}
        {tab === "team" && <TeamTab me={member} />}
        {tab === "history" && <HistoryTab />}
      </main>
    </div>
  );
}

/** Toutes les demandes de changement, par statut. */
function ChangesTab() {
  const list = useRequests();
  const [status, setStatus] = useState<ReqStatus | "">("ouvert");
  const shown = (list ?? []).filter((r) => !status || r.status === status);
  const count = (st: ReqStatus) => (list ?? []).filter((r) => r.status === st).length;
  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <h2>🛠 Changements demandés</h2>
          <p className="muted">
            Les demandes se font depuis la fiche d'une carte (onglet Cartes, en bas). Quand il y en a, dis à Claude d'« aller voir les changements » :
            il les lit, programme les effets, puis les marque ✅ Fait avec un mot d'explication.
          </p>
        </div>
      </header>
      <div className="adm-chips">
        {(["ouvert", "fait", "refusé", "annulé"] as ReqStatus[]).map((st) => (
          <button key={st} className={`adm-chip ${status === st ? "on" : ""}`} onClick={() => setStatus(st)}>{REQ_LABEL[st]} ({count(st)})</button>
        ))}
        <button className={`adm-chip ${status === "" ? "on" : ""}`} onClick={() => setStatus("")}>Toutes ({list?.length ?? 0})</button>
      </div>
      <div className="adm-card">
        {list === null ? <p className="muted">Chargement…</p> : shown.length ? <RequestList list={shown} showCard /> : <p className="muted">Aucune demande ici.</p>}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
