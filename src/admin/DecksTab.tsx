import { useEffect, useMemo, useState } from "react";
import { DECKS, PLACEHOLDER, cardImage, deckBack, defaultDeckBack, type DeckDef } from "../data/cards";
import { CONTENT, ORIGINAL_DECKS, isNewCard, type DeckEdit } from "../data/overrides";
import { CARDS } from "../data/cards";
import { SCRIPTS } from "../effects/scripts";
import { deckStatus, MIN_DECK } from "../effects/ready";
import { deckColor } from "../ui/pose";
import { deleteAsset, prepareImage, saveDeck, uploadAsset } from "./api";
import { DropZone, Field, SaveBar, Toggle, confirmLeave, useToast } from "./bits";

type Draft = Required<Omit<DeckEdit, "back">> & { back: { blob: Blob; url: string } | "reset" | null };
const DIFFS = ["", "Facile", "Moyen", "Difficile"];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");

function draftOf(name: string): Draft {
  const d = DECKS.find((x) => x.name === name)!;
  return {
    description: d.description ?? "", summary: d.summary ?? "", keywords: [...(d.keywords ?? [])], difficulty: d.difficulty ?? "",
    color: d.color ?? "", inGame: d.inGame, cards: [...d.cards], vcs: [...d.vcs], back: null,
  };
}

export default function DecksTab({ rev }: { rev: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const pick = (n: string) => {
    if (n === sel || !confirmLeave(dirty)) return;
    setDirty(false);
    setSel(n);
  };
  return (
    <div className="adm-split">
      <section className="adm-list-pane">
        <div className="adm-deck-list">
          {DECKS.map((d) => {
            const st = deckStatus(d);
            const back = deckBack(d.name);
            return (
              <button key={d.name} className={`adm-deck-row ${sel === d.name ? "on" : ""}`} onClick={() => pick(d.name)} style={{ ["--deck" as string]: deckColor(d.name) }}>
                <span className="adm-deck-thumb">
                  <img src={back ?? cardImage(d.cards[0] ?? "")} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
                </span>
                <span className="adm-deck-info">
                  <b>{d.name === "BASE" ? "Base (commune)" : d.name}</b>
                  <span className="small muted">{d.cards.length} cartes · {d.vcs.length} conditions</span>
                </span>
                <span className="adm-deck-state">
                  {CONTENT.decks?.[d.name] && <span className="adm-dot static" title="Modifié depuis l'Atelier" />}
                  {d.name === "BASE" ? null : st.ready ? <span className="adm-pill ok">Jouable</span> : <span className="adm-pill" title={st.why}>En cours</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="adm-edit-pane">
        {sel ? (
          <DeckEditor key={sel} name={sel} rev={rev} onDirty={setDirty} />
        ) : (
          <div className="adm-empty">
            <div className="adm-empty-icon">📦</div>
            <h2>Choisis un deck</h2>
            <p className="muted">Description, difficulté, couleur, dos des cartes, cartes incluses… tout se règle ici.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function DeckEditor({ name, rev, onDirty }: { name: string; rev: number; onDirty: (d: boolean) => void }) {
  const toast = useToast();
  const orig = ORIGINAL_DECKS.find((x) => x.name === name)!;
  const edit: DeckEdit = CONTENT.decks?.[name] ?? {};
  const [d, setD] = useState<Draft>(() => draftOf(name));
  const [busy, setBusy] = useState(false);
  const [kw, setKw] = useState("");
  const base = useMemo(() => draftOf(name), [name, rev]);
  const dirty = !same({ ...d, back: null }, base) || d.back !== null;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) setD(draftOf(name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  // Aperçu du statut avec le brouillon (jouable ou non).
  const preview: DeckDef = { ...orig, ...d, back: orig.back } as DeckDef;
  const st = deckStatus(preview);
  const allCards = orig.cards.concat(Object.values(CARDS).filter((c) => c.deck === name && c.kind === "card" && !orig.cards.includes(c.id)).map((c) => c.id));
  const allVcs = orig.vcs.concat(Object.values(CARDS).filter((c) => c.deck === name && c.kind === "victory" && !orig.vcs.includes(c.id)).map((c) => c.id));
  const toggleIn = (k: "cards" | "vcs", id: string, all: string[]) =>
    set(k, d[k].includes(id) ? d[k].filter((x) => x !== id) : all.filter((x) => x === id || d[k].includes(x)));

  const backNow = d.back && typeof d.back === "object" ? d.back.url : d.back === "reset" ? defaultDeckBack(name) : deckBack(name);
  const backCustom = d.back === null ? !!edit.back : typeof d.back === "object";

  const save = async () => {
    setBusy(true);
    try {
      const next: DeckEdit = {};
      const changed: string[] = [];
      const labels: Record<string, string> = {
        description: "description", summary: "résumé", keywords: "mots-clés", difficulty: "difficulté", color: "couleur",
        inGame: "dans le jeu", cards: "cartes", vcs: "conditions",
      };
      for (const k of Object.keys(labels) as (keyof typeof labels)[]) {
        const key = k as Exclude<keyof Draft, "back">;
        const o = (orig as unknown as Record<string, unknown>)[key] ?? (key === "keywords" ? [] : "");
        if (!same(d[key], o)) (next as Record<string, unknown>)[key] = d[key];
        if (!same((next as Record<string, unknown>)[key], (edit as Record<string, unknown>)[key])) changed.push(labels[k]);
      }
      if (d.back && typeof d.back === "object") {
        next.back = await uploadAsset(`back~${orig.code}`, d.back.blob);
        changed.push("dos des cartes");
      } else if (d.back === "reset") {
        await deleteAsset(`back~${orig.code}`);
        changed.push("dos d'origine");
      } else if (edit.back) next.back = edit.back;
      await saveDeck(name, next, `Deck « ${name} » : ${changed.join(", ") || "mise à jour"}`);
      set("back", null);
      toast("Deck enregistré ✔");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const resetAll = async () => {
    if (!confirm(`Remettre le deck « ${name} » comme à l'origine ?`)) return;
    setBusy(true);
    try {
      if (edit.back) await deleteAsset(`back~${orig.code}`);
      await saveDeck(name, {}, `Deck « ${name} » remis à l'origine`);
      setD(draftOf(name));
      toast("Deck remis à l'origine ✔");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const addKw = () => {
    const k = kw.trim();
    if (k && !d.keywords.includes(k)) set("keywords", [...d.keywords, k]);
    setKw("");
  };
  const color = /^#?[0-9a-f]{6}$/i.test(d.color) ? (d.color.startsWith("#") ? d.color : `#${d.color}`) : "";
  const isBase = name === "BASE";

  return (
    <div className="adm-editor">
      <header className="adm-editor-head" style={{ ["--deck" as string]: color || deckColor(name) }}>
        <div>
          <div className="adm-kicker">Deck · code {orig.code}</div>
          <h2 className="adm-deck-title">{isBase ? "Base (commune)" : name}</h2>
        </div>
        <div className="row">
          {!isBase && (st.ready ? <span className="adm-pill ok">✔ Jouable</span> : <span className="adm-pill">⏳ En cours : {st.why}</span>)}
          {Object.keys(edit).length > 0 && (
            <button className="ghost adm-danger" disabled={busy} onClick={resetAll}>↺ Tout remettre à l'origine</button>
          )}
        </div>
      </header>
      <div className="adm-editor-body">
        <aside className="adm-preview">
          <div className="adm-preview-card back" style={{ ["--deck" as string]: color || deckColor(name) }}>
            {backNow ? <img src={backNow} alt="" /> : <span className="adm-back-default"><span className="hole" /><span>{name}</span></span>}
          </div>
          <DropZone accept="image/*" label={backCustom ? "🖼 Changer le dos" : "🖼 Remplacer le dos des cartes"} onFile={async (f) => {
            try {
              const blob = await prepareImage(f);
              set("back", { blob, url: URL.createObjectURL(blob) });
            } catch (e) {
              toast((e as Error).message, true);
            }
          }} compact />
          {(backCustom || d.back === "reset") && (
            <button className="adm-link" onClick={() => set("back", d.back === null ? "reset" : null)}>
              {d.back === null ? "↺ Dos d'origine" : "✕ Annuler le changement"}
            </button>
          )}
        </aside>
        <div className="adm-form">
          {!isBase && (
            <Field label="Disponible dans le salon" changed={d.inGame !== orig.inGame} onReset={() => set("inGame", orig.inGame)}
              hint={`Un deck n'est jouable que s'il a au moins ${MIN_DECK} cartes, toutes automatisées, et une condition de victoire automatisée.`}>
              <Toggle on={d.inGame} onChange={(v) => set("inGame", v)} label={d.inGame ? "Oui, les joueurs peuvent le choisir" : "Non, caché aux joueurs"} />
            </Field>
          )}
          <Field label="Résumé (affiché dans le salon)" changed={!same(d.summary, orig.summary)} original={orig.summary} onReset={() => set("summary", orig.summary ?? "")}>
            <textarea rows={2} value={d.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <Field label="Description" changed={!same(d.description, orig.description)} original={orig.description} onReset={() => set("description", orig.description)}>
            <textarea rows={3} value={d.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="adm-two">
            <Field label="Difficulté" changed={!same(d.difficulty, orig.difficulty)} onReset={() => set("difficulty", orig.difficulty ?? "")}>
              <select value={d.difficulty} onChange={(e) => set("difficulty", e.target.value)}>
                {DIFFS.map((x) => <option key={x} value={x}>{x || "—"}</option>)}
              </select>
            </Field>
            <Field label="Couleur" changed={!same(d.color, orig.color)} onReset={() => set("color", orig.color)}>
              <div className="row">
                <input type="color" value={color || "#5a33c9"} onChange={(e) => set("color", e.target.value)} />
                <span className="small muted">{color || "automatique"}</span>
                {d.color && <button className="adm-link" onClick={() => set("color", "")}>auto</button>}
              </div>
            </Field>
          </div>
          <Field label="Mots-clés" changed={!same(d.keywords, orig.keywords ?? [])} onReset={() => set("keywords", [...(orig.keywords ?? [])])}>
            <div className="adm-kw">
              {d.keywords.map((k) => (
                <span key={k} className="adm-kw-chip">
                  {k}
                  <button onClick={() => set("keywords", d.keywords.filter((x) => x !== k))} aria-label={`Retirer ${k}`}>×</button>
                </span>
              ))}
              <input value={kw} placeholder="Ajouter + Entrée" onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKw()} onBlur={addKw} />
            </div>
          </Field>
          <Field label={`Cartes du deck (${d.cards.length}/${allCards.length})`} changed={!same(d.cards, orig.cards)} onReset={() => set("cards", [...orig.cards])}
            hint="Clique sur une carte pour la retirer du deck ou la remettre. ⚠ = pas encore automatisée (le deck ne sera plus jouable tant qu'elle y est).">
            <div className="adm-pick-grid">
              {allCards.map((id) => (
                <button key={id} className={`adm-pick ${d.cards.includes(id) ? "in" : "out"}`} onClick={() => toggleIn("cards", id, allCards)} title={`${CARDS[id]?.name}${SCRIPTS[id] ? "" : " — pas encore automatisée"}`}>
                  {!SCRIPTS[id] && <i className="adm-pick-warn">⚠</i>}
                  {isNewCard(id) && <i className="adm-pick-new">🆕</i>}
                  <img src={cardImage(id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
                  <span>{CARDS[id]?.name}</span>
                </button>
              ))}
            </div>
          </Field>
          {allVcs.length > 0 && (
            <Field label={`Conditions de victoire (${d.vcs.length}/${allVcs.length})`} changed={!same(d.vcs, orig.vcs)} onReset={() => set("vcs", [...orig.vcs])}>
              <div className="adm-pick-grid">
                {allVcs.map((id) => (
                  <button key={id} className={`adm-pick ${d.vcs.includes(id) ? "in" : "out"}`} onClick={() => toggleIn("vcs", id, allVcs)} title={CARDS[id]?.name}>
                    <img src={cardImage(id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
                    <span>{CARDS[id]?.name}</span>
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onCancel={() => setD(draftOf(name))} />
    </div>
  );
}
