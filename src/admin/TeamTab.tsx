import { useEffect, useState } from "react";
import {
  ROLE_LABEL, createInvite, deleteInvite, inviteLink, removeMember, setRole, watchHistory, watchInvites, watchMembers,
  type HistoryEntry, type Invite, type Member, type Role,
} from "./api";
import { useToast } from "./bits";

const Avatar = ({ m }: { m: { name: string; photo?: string } }) =>
  m.photo ? <img className="adm-avatar" src={m.photo} alt="" referrerPolicy="no-referrer" /> : <span className="adm-avatar">{m.name.slice(0, 1).toUpperCase()}</span>;

export default function TeamTab({ me }: { me: Member }) {
  const toast = useToast();
  const owner = me.role === "owner";
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => watchMembers(setMembers), []);
  useEffect(() => (owner ? watchInvites(setInvites) : undefined), [owner]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      toast("Lien copié ✔");
    } catch {
      toast("Copie impossible : sélectionne le lien à la main.", true);
    }
  };
  const invite = async () => {
    try {
      const code = await createInvite(note.trim());
      setFresh(code);
      setNote("");
      void copy(code);
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    }
  };
  const now = Date.now();

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <h2>👥 Équipe</h2>
          <p className="muted">
            Les membres se connectent avec leur compte Google et peuvent tout modifier dans l'Atelier.
            {owner ? " Tu es propriétaire : tu invites et retires des membres." : " Seul le propriétaire peut inviter ou retirer quelqu'un."}
          </p>
        </div>
      </header>

      {owner && (
        <div className="adm-card">
          <h3>✉️ Inviter un pote</h3>
          <p className="small muted">Crée un lien d'invitation et envoie-le-lui. Il sert <b>une seule fois</b> et expire dans 7 jours.</p>
          <div className="row">
            <input className="grow" placeholder="Pour qui ? (ex. « Lucas »)" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && invite()} />
            <button className="primary" onClick={invite}>Créer un lien</button>
          </div>
          {fresh && (
            <div className="adm-invite-fresh">
              <code>{inviteLink(fresh)}</code>
              <button onClick={() => copy(fresh)}>📋 Copier</button>
            </div>
          )}
          {invites.length > 0 && (
            <ul className="adm-invites">
              {invites.map((i) => {
                const exp = i.expiresAt.toMillis();
                return (
                  <li key={i.code} className={exp < now ? "expired" : ""}>
                    <span>
                      <b>{i.note || "Invitation"}</b>
                      <span className="small muted"> · {exp < now ? "expirée" : `expire le ${new Date(exp).toLocaleDateString("fr-FR")}`}</span>
                    </span>
                    {exp >= now && <button onClick={() => copy(i.code)}>📋 Lien</button>}
                    <button className="adm-link" onClick={() => deleteInvite(i.code)}>Supprimer</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="adm-card">
        <h3>Membres ({members.length})</h3>
        <ul className="adm-members">
          {members
            .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "owner" ? -1 : 1))
            .map((m) => (
              <li key={m.uid}>
                <Avatar m={m} />
                <span className="grow">
                  <b>{m.name}</b>{m.uid === me.uid && <span className="small muted"> (toi)</span>}
                  {owner && m.email && <span className="small muted"> · {m.email}</span>}
                </span>
                {owner && m.uid !== me.uid ? (
                  <>
                    <select value={m.role} onChange={(e) => setRole(m.uid, e.target.value as Role).catch((x) => toast((x as Error).message, true))}>
                      <option value="editor">{ROLE_LABEL.editor}</option>
                      <option value="owner">{ROLE_LABEL.owner}</option>
                    </select>
                    <button className="adm-link adm-danger" onClick={() => confirm(`Retirer ${m.name} de l'équipe ?`) && removeMember(m.uid).catch((x) => toast((x as Error).message, true))}>
                      Retirer
                    </button>
                  </>
                ) : (
                  <span className="adm-pill">{ROLE_LABEL[m.role]}</span>
                )}
                {!owner && m.uid === me.uid && (
                  <button className="adm-link adm-danger" onClick={() => confirm("Quitter l'équipe de l'Atelier ?") && removeMember(me.uid)}>Quitter</button>
                )}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

export function HistoryTab() {
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  useEffect(() => watchHistory(setList), []);
  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <h2>📜 Historique</h2>
          <p className="muted">Les 60 dernières modifications, de la plus récente à la plus ancienne.</p>
        </div>
      </header>
      <div className="adm-card">
        {list === null ? (
          <p className="muted">Chargement…</p>
        ) : !list.length ? (
          <p className="muted">Aucune modification pour l'instant.</p>
        ) : (
          <ul className="adm-history">
            {list.map((h) => (
              <li key={h.id}>
                <span className="adm-history-when">{h.at ? h.at.toDate().toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "…"}</span>
                <span className="adm-history-who">{h.name}</span>
                <span className="grow">{h.what}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
