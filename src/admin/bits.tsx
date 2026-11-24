// Petits éléments partagés par les onglets de l'Atelier.
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
/** Affiche un message en bas de l'écran (« Enregistré ✔ », erreurs…). */
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = (text: string, bad = false) => {
    const id = ++n.current;
    setList((l) => [...l, { id, text, bad }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), bad ? 6000 : 2800);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="adm-toasts" role="status">
        {list.map((t) => (
          <div key={t.id} className={`adm-toast ${t.bad ? "bad" : ""}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Champ avec son titre, une aide et (s'il a changé) la valeur d'origine à restaurer. */
export function Field({ label, hint, changed, original, onReset, children }: {
  label: string; hint?: ReactNode; changed?: boolean; original?: string; onReset?: () => void; children: ReactNode;
}) {
  return (
    <div className={`adm-field ${changed ? "changed" : ""}`}>
      <div className="adm-field-head">
        <span className="adm-label">{label}</span>
        {changed && <span className="adm-pill warm">modifié</span>}
        {changed && onReset && (
          <button type="button" className="adm-link" onClick={onReset} title="Remettre la valeur d'origine">↺ original</button>
        )}
      </div>
      {children}
      {hint && <div className="adm-hint">{hint}</div>}
      {changed && original !== undefined && (
        <details className="adm-orig">
          <summary>Voir l'original</summary>
          <div>{original || <i>(vide)</i>}</div>
        </details>
      )}
    </div>
  );
}

/** Zone où déposer (ou choisir) un fichier. */
export function DropZone({ accept, label, onFile, children, compact }: {
  accept: string; label: string; onFile: (f: File) => void; children?: ReactNode; compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`adm-drop ${over ? "over" : ""} ${compact ? "compact" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
    >
      {children}
      <span className="adm-drop-label">{label}</span>
      <input
        ref={input} type="file" accept={accept} hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="adm-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="adm-switch" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/** Barre « Enregistrer / Annuler » collée en bas de l'éditeur. */
export function SaveBar({ dirty, busy, onSave, onCancel, extra }: {
  dirty: boolean; busy: boolean; onSave: () => void; onCancel: () => void; extra?: ReactNode;
}) {
  return (
    <div className={`adm-savebar ${dirty ? "dirty" : ""}`}>
      <span className="adm-savebar-msg">{busy ? "⏳ Enregistrement…" : dirty ? "● Modifications non enregistrées" : "✔ Tout est enregistré"}</span>
      {extra}
      <button className="ghost" disabled={!dirty || busy} onClick={onCancel}>Annuler</button>
      <button className="primary" disabled={!dirty || busy} onClick={onSave}>Enregistrer</button>
    </div>
  );
}

export const fmtDate = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

/** Si le brouillon a des changements, demande avant de le perdre. */
export const confirmLeave = (dirty: boolean) => !dirty || confirm("Tu as des changements non enregistrés. Les abandonner ?");
