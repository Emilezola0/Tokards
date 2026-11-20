import { useEffect, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, ensureSignedIn } from "../firebase";
import { sfx } from "./sfx";

// Demande de retrait : crée un ticket dans la collection Firestore `tickets` (lisible seulement depuis la console Firebase).
const KINDS = [
  { id: "son", label: "🔊 Un son / une voiceline" },
  { id: "image", label: "🖼️ Une image / une carte" },
  { id: "autre", label: "📝 Autre chose" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

export default function Takedown() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("son");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open]);

  const send = async () => {
    setState("busy");
    try {
      const user = await ensureSignedIn();
      await addDoc(collection(db, "tickets"), {
        uid: user.uid,
        kind,
        target: target.trim(),
        message: message.trim(),
        contact: contact.trim(),
        page: location.href.slice(0, 300),
        status: "ouvert",
        createdAt: serverTimestamp(),
      });
      setState("sent");
      setTarget("");
      setMessage("");
      setContact("");
    } catch {
      setState("error");
    }
  };

  const close = () => (setOpen(false), state === "sent" && setState("idle"));

  return (
    <>
      <button className="takedown-link ghost small" onClick={() => (sfx.click(), setOpen(true))}>
        ⚖️ Demande de retrait de contenu
      </button>
      {open && (
        <div className="modal-bg" onClick={close}>
          <div className="modal panel takedown" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 className="grow">⚖️ Demande de retrait</h2>
              <button className="ghost" onClick={close}>✕</button>
            </div>
            {state === "sent" ? (
              <>
                <p>✅ Ta demande est enregistrée. Le contenu concerné sera retiré dès qu'elle aura été lue.</p>
                <button className="primary" onClick={close}>Fermer</button>
              </>
            ) : (
              <>
                <p className="small muted">
                  Tokards est un jeu privé entre amis, sans but commercial. Si un son, une image ou un autre contenu t'appartient et
                  que tu veux qu'il soit retiré, dis-le ici : il sera enlevé.
                </p>
                <label>
                  Type de contenu
                  <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                    {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </label>
                <label>
                  Contenu concerné
                  <input value={target} maxLength={200} onChange={(e) => setTarget(e.target.value)} placeholder="Ex. : les cris des cartes Poro" />
                </label>
                <label>
                  Message
                  <textarea value={message} maxLength={2000} rows={4} onChange={(e) => setMessage(e.target.value)} placeholder="Qui es-tu, et pourquoi faut-il le retirer ?" />
                </label>
                <label>
                  <span>Contact pour te répondre <span className="muted">(facultatif)</span></span>
                  <input value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} placeholder="E-mail ou autre" />
                </label>
                {state === "error" && <p className="error">L'envoi a échoué, réessaie dans un instant.</p>}
                <button className="primary" disabled={state === "busy" || !target.trim() || !message.trim()} onClick={send}>
                  {state === "busy" ? "Envoi…" : "Envoyer la demande"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
