import { useEffect, useMemo, useState } from "react";
import { CARDS, DECKS, PLACEHOLDER, cardImage, defaultCardImage, tagIcons, type Tags } from "../data/cards";
import { CONTENT, ORIGINAL_DECKS, baseCard, isNewCard, type CardEdit } from "../data/overrides";
import type { CardDef } from "../data/cards";
import CardView from "../ui/CardView";
import { defaultVoiceUrl, voiceUrl } from "../ui/voice";
import { SCRIPTS } from "../effects/scripts";
import {
  REQ_LABEL, addRequest, cancelRequest, createCard, deleteAsset, prepareAudio, prepareImage, reopenRequest, saveCard, saveMany, uploadAsset,
  useRequests, type ChangeRequest, type Entry,
} from "./api";
import { DropZone, Field, SaveBar, Toggle, confirmLeave, useToast } from "./bits";

type FileDraft = { blob: Blob; url: string } | "reset" | "mute" | null;
type Draft = {
  name: string; text: string; rules: string; tags: Tags; trigger: string; event: string; target: string; inDeck: boolean;
  img: FileDraft; voice: FileDraft;
};
const TRIGGERS = ["Activation", "Passif", "Les deux", ""];

const TAGS: { k: keyof Tags; label: string }[] = [
  { k: "sentience", label: "🧠 Sentience" },
  { k: "gold", label: "💰 Gold" },
  { k: "blackHole", label: "🌀 Trou noir" },
];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
/** La carte est-elle dans la pioche (ou les conditions) de son deck ? */
const inDeckOf = (id: string) => {
  const c = CARDS[id];
  const d = DECKS.find((x) => x.name === c?.deck);
  return !!d && (c.kind === "victory" ? d.vcs : d.cards).includes(id);
};
/** Modification du deck pour y mettre (ou en retirer) une carte. */
function deckEntry(deckName: string, kind: CardDef["kind"], id: string, include: boolean): Entry {
  const d = DECKS.find((x) => x.name === deckName)!;
  const k = kind === "victory" ? "vcs" : "cards";
  const list = include ? [...d[k].filter((x) => x !== id), id] : d[k].filter((x) => x !== id);
  const orig = ORIGINAL_DECKS.find((x) => x.name === deckName)!;
  const e = { ...(CONTENT.decks?.[deckName] ?? {}) };
  if (same(list, orig[k])) delete e[k];
  else e[k] = list;
  return ["decks", deckName, e];
}
/** Prochain identifiant libre d'un deck : GOB-33, VC-GOB-4… */
function nextId(code: string, kind: CardDef["kind"]) {
  const re = kind === "victory" ? new RegExp(`^VC-${code}-(\\d+)$`) : new RegExp(`^${code}-(\\d+)$`);
  const max = Math.max(0, ...Object.keys(CARDS).map((id) => Number(id.match(re)?.[1] ?? 0)));
  return kind === "victory" ? `VC-${code}-${max + 1}` : `${code}-${String(max + 1).padStart(2, "0")}`;
}
const playUrl = (url: string | null) => url && void new Audio(url).play().catch(() => {});

function draftOf(id: string): Draft {
  const c = CARDS[id];
  return {
    name: c.name, text: c.text, rules: c.rules ?? "", tags: { ...c.tags }, trigger: c.trigger, event: c.event, target: c.target,
    inDeck: inDeckOf(id), img: null, voice: null,
  };
}

export default function CardsTab({ rev }: { rev: number }) {
  const [deck, setDeck] = useState<string>(DECKS.find((d) => d.inGame && d.name !== "BASE")?.name ?? "");
  const [q, setQ] = useState("");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return Object.values(CARDS)
      .filter((c) => (!deck || c.deck === deck) && (!onlyEdited || CONTENT.cards?.[c.id]))
      .filter((c) => !n || `${c.id} ${c.name} ${c.text}`.toLowerCase().includes(n))
      .sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id, "fr", { numeric: true }) : a.kind === "card" ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, q, onlyEdited, rev]);

  const pick = (id: string | null) => {
    if ((id === sel && !creating) || !confirmLeave(dirty)) return;
    setDirty(false);
    setCreating(false);
    setSel(id);
  };
  // Carte supprimée (par soi ou un autre membre) : on ferme son éditeur.
  useEffect(() => {
    if (sel && !CARDS[sel]) setSel(null);
  }, [rev, sel]);
  const edited = Object.keys(CONTENT.cards ?? {}).length;

  return (
    <div className="adm-split">
      <section className="adm-list-pane">
        <div className="adm-toolbar">
          <input className="adm-search" placeholder="🔎 Chercher une carte (nom, ID, texte)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="primary adm-new" onClick={() => confirmLeave(dirty) && (setDirty(false), setSel(null), setCreating(true))}>＋ Nouvelle</button>
        </div>
        <div className="adm-chips">
          <button className={`adm-chip ${deck === "" ? "on" : ""}`} onClick={() => setDeck("")}>Toutes</button>
          {DECKS.map((d) => (
            <button key={d.name} className={`adm-chip ${deck === d.name ? "on" : ""}`} onClick={() => setDeck(d.name)}>
              {d.name === "BASE" ? "Base" : d.name}
            </button>
          ))}
        </div>
        <label className="adm-check small">
          <input type="checkbox" checked={onlyEdited} onChange={(e) => setOnlyEdited(e.target.checked)} /> Seulement les cartes modifiées ({edited})
        </label>
        <div className="adm-card-grid">
          {list.map((c) => (
            <button key={c.id} className={`adm-tile ${sel === c.id ? "on" : ""}`} onClick={() => pick(c.id)} title={c.name}>
              <img src={cardImage(c.id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
              {CONTENT.cards?.[c.id] && <span className="adm-dot" title="Modifiée depuis l'Atelier" />}
              {c.kind === "victory" && <span className="adm-tile-vc">🏁</span>}
              {isNewCard(c.id) && <span className="adm-tile-new" title="Créée dans l'Atelier">🆕</span>}
              <span className="adm-tile-name">{c.name}</span>
              <span className="adm-tile-id">{c.id}</span>
            </button>
          ))}
          {!list.length && <p className="muted">Aucune carte ne correspond.</p>}
        </div>
      </section>
      <section className="adm-edit-pane">
        {creating ? (
          <NewCard
            deck={deck}
            onCancel={() => setCreating(false)}
            onDone={(id, deckName) => {
              setCreating(false);
              setDeck(deckName);
              setSel(id);
            }}
          />
        ) : sel && CARDS[sel] ? (
          <CardEditor key={`${sel}`} id={sel} rev={rev} onDirty={setDirty} />
        ) : (
          <div className="adm-empty">
            <div className="adm-empty-icon">🃏</div>
            <h2>Choisis une carte</h2>
            <p className="muted">Clique sur une carte à gauche pour changer son nom, son texte, son image ou sa voiceline, ou crée-en une nouvelle avec « ＋ Nouvelle ».</p>
          </div>
        )}
      </section>
    </div>
  );
}

function CardEditor({ id, rev, onDirty }: { id: string; rev: number; onDirty: (d: boolean) => void }) {
  const toast = useToast();
  const orig = baseCard(id)!;
  const created = isNewCard(id);
  const edit: CardEdit = CONTENT.cards?.[id] ?? {};
  const [d, setD] = useState<Draft>(() => draftOf(id));
  const [busy, setBusy] = useState(false);
  const base = useMemo(() => draftOf(id), [id, rev]);
  const dirty = !same({ ...d, img: null, voice: null }, base) || d.img !== null || d.voice !== null;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // Le contenu a changé ailleurs (autre membre) et on n'a rien touché : on suit.
  useEffect(() => {
    if (!dirty) setD(draftOf(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    addEventListener("beforeunload", before);
    return () => removeEventListener("beforeunload", before);
  }, [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const onImage = async (f: File) => {
    try {
      const blob = await prepareImage(f);
      set("img", { blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const onVoice = (f: File) => {
    try {
      const blob = prepareAudio(f);
      set("voice", { blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const imgNow = typeof d.img === "object" && d.img ? d.img.url : d.img === "reset" ? defaultCardImage(id) : cardImage(id);
  const voiceNow =
    typeof d.voice === "object" && d.voice ? d.voice.url : d.voice === "mute" ? null : d.voice === "reset" ? defaultVoiceUrl(id) : voiceUrl(id);
  const imgCustom = d.img === null ? !!edit.img : typeof d.img === "object";
  const voiceState = d.voice === null ? (edit.voice === -1 ? "mute" : edit.voice ? "custom" : "orig") : typeof d.voice === "object" ? "custom" : d.voice === "mute" ? "mute" : "orig";

  const save = async () => {
    setBusy(true);
    try {
      const next: CardEdit = {};
      const changed: string[] = [];
      if (!same(d.name, orig.name)) next.name = d.name.trim();
      if (!same(d.text, orig.text)) next.text = d.text;
      if (!same(d.rules, orig.rules ?? "")) next.rules = d.rules;
      if (!same(d.tags, orig.tags)) next.tags = d.tags;
      if (created) {
        if (!same(d.trigger, orig.trigger)) next.trigger = d.trigger;
        if (!same(d.event, orig.event)) next.event = d.event;
        if (!same(d.target, orig.target)) next.target = d.target;
      }
      const LABELS = [["name", "nom"], ["text", "texte"], ["rules", "précisions"], ["tags", "tags"], ["trigger", "déclenchement"], ["event", "moment"], ["target", "cible"]] as const;
      for (const [k, label] of LABELS) if (!same(next[k], edit[k])) changed.push(label);
      const extra: Entry[] = [];
      if (d.inDeck !== inDeckOf(id)) {
        extra.push(deckEntry(c.deck, c.kind, id, d.inDeck));
        changed.push(d.inDeck ? "ajoutée au deck" : "retirée du deck");
      }
      // Image
      if (typeof d.img === "object" && d.img) {
        next.img = await uploadAsset(`card~${id}`, d.img.blob);
        changed.push("image");
      } else if (d.img === "reset") {
        await deleteAsset(`card~${id}`);
        changed.push("image d'origine");
      } else if (edit.img) next.img = edit.img;
      // Voix
      if (typeof d.voice === "object" && d.voice) {
        next.voice = await uploadAsset(`voice~${id}`, d.voice.blob);
        changed.push("voiceline");
      } else if (d.voice === "mute") {
        if (edit.voice && edit.voice > 0) await deleteAsset(`voice~${id}`);
        next.voice = -1;
        changed.push("voiceline coupée");
      } else if (d.voice === "reset") {
        if (edit.voice && edit.voice > 0) await deleteAsset(`voice~${id}`);
        changed.push("voiceline d'origine");
      } else if (edit.voice) next.voice = edit.voice;
      await saveCard(id, next, `Carte « ${next.name ?? orig.name} » (${id}) : ${changed.join(", ") || "mise à jour"}`, extra);
      setD((x) => ({ ...x, img: null, voice: null }));
      toast("Carte enregistrée ✔");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const resetAll = async () => {
    if (!confirm(`Remettre « ${orig.name} » exactement comme à l'origine (texte, image et voix) ?`)) return;
    setBusy(true);
    try {
      if (edit.img) await deleteAsset(`card~${id}`);
      if (edit.voice && edit.voice > 0) await deleteAsset(`voice~${id}`);
      await saveCard(id, {}, `Carte « ${orig.name} » (${id}) remise à l'origine`);
      setD(draftOf(id));
      toast("Carte remise à l'origine ✔");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const c = CARDS[id];
  const scripted = !!SCRIPTS[id];
  const remove = async () => {
    if (!confirm(`Supprimer définitivement la carte « ${c.name} » (${id}) ? Elle sera aussi retirée de son deck.`)) return;
    setBusy(true);
    try {
      if (edit.img) await deleteAsset(`card~${id}`);
      if (edit.voice && edit.voice > 0) await deleteAsset(`voice~${id}`);
      await saveMany([["newCards", id, undefined], ["cards", id, undefined], deckEntry(c.deck, c.kind, id, false)], `Carte « ${c.name} » (${id}) supprimée`);
      onDirty(false);
      toast("Carte supprimée");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
      setBusy(false);
    }
  };
  return (
    <div className="adm-editor">
      <header className="adm-editor-head">
        <div>
          <div className="adm-kicker">{c.deck === "BASE" ? "Base" : c.deck} · {id} · {c.kind === "victory" ? "Condition de victoire" : "Carte"}</div>
          <h2>{d.name || <i className="muted">Sans nom</i>} {created && <span className="adm-pill accent">🆕 Créée dans l'Atelier</span>}</h2>
        </div>
        {created && (
          <button className="ghost adm-danger" disabled={busy} onClick={remove}>🗑 Supprimer la carte</button>
        )}
        {Object.keys(edit).length > 0 && (
          <button className="ghost adm-danger" disabled={busy} onClick={resetAll} title="Effacer toutes les modifications de cette carte">
            ↺ Tout remettre à l'origine
          </button>
        )}
      </header>

      <div className="adm-editor-body">
        <aside className="adm-preview">
          <div className="adm-preview-card">
            <img src={imgNow} alt="" onError={(e) => (e.currentTarget.src = PLACEHOLDER)} />
            <span className="adm-preview-tags">{c.kind === "victory" ? "🏁" : tagIcons(d.tags)}</span>
            <span className="adm-preview-name">{d.name}</span>
          </div>
          <div className="adm-mini-row">
            <span className="small muted">En jeu :</span>
            <CardView id={id} size="s" ghost />
          </div>
          <DropZone accept="image/*" label={imgCustom ? "🖼 Changer l'image" : "🖼 Remplacer l'image"} onFile={onImage} compact />
          <div className="adm-row-btns">
            {(imgCustom || d.img === "reset") && (
              <button className="adm-link" onClick={() => set("img", d.img === null ? "reset" : null)}>
                {d.img === null ? "↺ Image d'origine" : "✕ Annuler le changement d'image"}
              </button>
            )}
          </div>
          <p className="adm-hint">L'image est redimensionnée et convertie en WebP automatiquement (format conseillé : 2:3, portrait).</p>
        </aside>

        <div className="adm-form">
          <Field label="Nom" changed={!same(d.name, orig.name)} original={orig.name} onReset={() => set("name", orig.name)}>
            <input value={d.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field
            label="Texte de la carte"
            changed={!same(d.text, orig.text)}
            original={orig.text}
            onReset={() => set("text", orig.text)}
            hint={SCRIPTS[id] ? <>⚙ L'effet est programmé dans le code : changer le texte change ce qui est <b>affiché</b>, pas ce que fait la carte.</> : undefined}
          >
            <textarea rows={5} value={d.text} onChange={(e) => set("text", e.target.value)} />
          </Field>
          <Field label="Précisions (règles)" changed={!same(d.rules, orig.rules ?? "")} original={orig.rules ?? ""} onReset={() => set("rules", orig.rules ?? "")}>
            <textarea rows={3} value={d.rules} placeholder="Détails affichés dans la fiche de la carte" onChange={(e) => set("rules", e.target.value)} />
          </Field>
          {c.kind === "card" && (
            <Field
              label="Tags"
              changed={!same(d.tags, orig.tags)}
              onReset={() => set("tags", { ...orig.tags })}
              hint="⚠ Les tags comptent dans les règles (cartes qui ciblent les 🧠, conditions de victoire…) : ils changent la partie."
            >
              <div className="adm-tag-row">
                {TAGS.map((t) => (
                  <label key={t.k} className={`adm-tag ${d.tags[t.k] ? "on" : ""}`}>
                    <input type="checkbox" checked={d.tags[t.k]} onChange={(e) => set("tags", { ...d.tags, [t.k]: e.target.checked })} />
                    {t.label}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field
            label={c.kind === "victory" ? "Dans les conditions du deck" : "Dans la pioche du deck"}
            changed={d.inDeck !== inDeckOf(id)}
            onReset={() => set("inDeck", inDeckOf(id))}
            hint={
              scripted || !d.inDeck
                ? undefined
                : <>⚠ Cette carte n'est pas encore automatisée : tant qu'elle est dans le deck, « {c.deck} » passe « en cours » et ne peut plus être choisi en partie. Décris ce qu'elle doit faire dans <b>Changements</b> plus bas, puis demande à Claude de l'automatiser.</>
            }
          >
            <Toggle on={d.inDeck} onChange={(v) => set("inDeck", v)} label={d.inDeck ? `Oui, jouée avec « ${c.deck} »` : `Non : rangée dans « ${c.deck} » mais pas jouée`} />
          </Field>
          {created && (
            <Field label="Déclenchement" hint="Affiché sur la carte. Ce que fait vraiment la carte sera programmé par Claude d'après les Changements.">
              <div className="adm-trigger">
                <select value={d.trigger} onChange={(e) => set("trigger", e.target.value)}>
                  {TRIGGERS.map((t) => <option key={t} value={t}>{t || "—"}</option>)}
                </select>
                <input placeholder="Moment (ex. Début du tour)" value={d.event} onChange={(e) => set("event", e.target.value)} />
                <input placeholder="Cible (ex. Un joueur)" value={d.target} onChange={(e) => set("target", e.target.value)} />
              </div>
            </Field>
          )}
          {!created && (c.trigger || c.event) && (
            <div className="adm-readonly">
              <span className="adm-label">Déclenchement</span>
              <span>
                {c.trigger && <span className="badge">{c.trigger}</span>} {c.event} {c.target && <span className="muted">· cible : {c.target}</span>}
              </span>
              <span className="adm-hint">Fixé par le code du jeu (non modifiable ici).</span>
            </div>
          )}

          <Field label="Voiceline" changed={d.voice !== null}>
            <div className="adm-voice">
              <span className={`adm-pill ${voiceState === "custom" ? "accent" : voiceState === "mute" ? "bad" : ""}`}>
                {voiceState === "custom" ? "🎙 Voix remplacée" : voiceState === "mute" ? "🔇 Coupée" : defaultVoiceUrl(id) ? "🗣 Voix d'origine" : "Aucune voix"}
              </span>
              <button disabled={!voiceNow} onClick={() => playUrl(voiceNow)}>▶ Écouter</button>
              <DropZone accept="audio/*,.mp3,.ogg,.wav,.m4a,.webm" label="🎙 Remplacer…" onFile={onVoice} compact />
              {voiceState !== "mute" && (voiceNow || edit.voice) && <button className="adm-link" onClick={() => set("voice", "mute")}>🔇 Couper</button>}
              {(voiceState !== "orig" || d.voice !== null) && (
                <button className="adm-link" onClick={() => set("voice", d.voice === null ? "reset" : null)}>
                  {d.voice === null ? "↺ Voix d'origine" : "✕ Annuler"}
                </button>
              )}
            </div>
            <div className="adm-hint">MP3 conseillé, 700 Ko max (quelques secondes).</div>
          </Field>
          <CardRequests id={id} name={c.name} />
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onCancel={() => setD(draftOf(id))} />
    </div>
  );
}

/** Créer une carte : deck, type et nom ; le reste se règle ensuite dans l'éditeur. */
function NewCard({ deck, onCancel, onDone }: { deck: string; onCancel: () => void; onDone: (id: string, deck: string) => void }) {
  const toast = useToast();
  const decks = DECKS.filter((d) => d.code);
  const [deckName, setDeckName] = useState(
    decks.find((d) => d.name === deck)?.name ?? decks.find((d) => d.inGame && d.name !== "BASE")?.name ?? decks[0]?.name ?? "",
  );
  const [kind, setKind] = useState<CardDef["kind"]>("card");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const d = DECKS.find((x) => x.name === deckName);
  const id = d ? nextId(d.code, kind) : "";
  const create = async () => {
    if (!d || !name.trim()) return toast("Donne au moins un nom à la carte.", true);
    setBusy(true);
    try {
      const def: CardDef = {
        id, kind, deck: d.name, name: name.trim(), text, rules: "", image: "", claude: "",
        tags: { sentience: false, gold: false, blackHole: false },
        trigger: kind === "victory" ? "" : "Activation", event: "", target: "", check: "",
      };
      await createCard(def, null);
      toast(`Carte ${id} créée ✔`);
      onDone(id, d.name);
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
      setBusy(false);
    }
  };
  return (
    <div className="adm-editor">
      <header className="adm-editor-head">
        <div>
          <div className="adm-kicker">Nouvelle carte · {id}</div>
          <h2>{name || <i className="muted">Nouvelle carte</i>}</h2>
        </div>
      </header>
      <div className="adm-editor-body single">
        <div className="adm-form">
          <Field label="Deck" hint="La carte est rangée dans ce deck. Elle n'est jouée que quand tu l'y ajoutes (dans son éditeur, une fois créée).">
            <select value={deckName} onChange={(e) => setDeckName(e.target.value)}>
              {decks.map((x) => <option key={x.name} value={x.name}>{x.name === "BASE" ? "Base (commune)" : x.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <div className="adm-tag-row">
              <label className={`adm-tag ${kind === "card" ? "on" : ""}`}><input type="radio" checked={kind === "card"} onChange={() => setKind("card")} />🃏 Carte</label>
              <label className={`adm-tag ${kind === "victory" ? "on" : ""}`}><input type="radio" checked={kind === "victory"} onChange={() => setKind("victory")} />🏁 Condition de victoire</label>
            </div>
          </Field>
          <Field label="Nom">
            <input autoFocus value={name} maxLength={60} placeholder="Nom de la carte" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </Field>
          <Field label="Texte de la carte" hint="Ensuite : image, voix, tags, et la description de l'effet voulu dans « Changements ».">
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="adm-savebar dirty">
        <span className="adm-savebar-msg">Identifiant de la carte : <b>{id}</b></span>
        <button className="ghost" disabled={busy} onClick={onCancel}>Annuler</button>
        <button className="primary" disabled={busy || !name.trim()} onClick={create}>Créer la carte</button>
      </div>
    </div>
  );
}

/** Changements demandés pour une carte : idées d'effet, corrections… que Claude lira et automatisera sur demande. */
function CardRequests({ id, name }: { id: string; name: string }) {
  const toast = useToast();
  const all = useRequests();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = (all ?? []).filter((r) => r.card === id);
  const open = list.filter((r) => r.status === "ouvert").length;
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addRequest(id, name, text.trim());
      setText("");
      toast("Demande envoyée ✔");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="adm-field adm-requests">
      <div className="adm-field-head">
        <span className="adm-label">🛠 Changements</span>
        {open > 0 && <span className="adm-pill warm">{open} en attente</span>}
      </div>
      <div className="adm-hint">
        Décris un nouvel effet, une règle à corriger, une idée… Claude lit ces demandes quand on lui dit d'aller voir les changements, puis les programme.
      </div>
      {list.length > 0 && <RequestList list={list} />}
      <textarea rows={3} value={text} maxLength={2000} placeholder="Ex. : « Au lieu de voler 2 💰, vole 3 💰 et pioche une carte. »" onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <span className="grow" />
        <button className="primary" disabled={busy || !text.trim()} onClick={send}>Envoyer la demande</button>
      </div>
    </div>
  );
}

export function RequestList({ list, showCard }: { list: ChangeRequest[]; showCard?: boolean }) {
  const toast = useToast();
  const act = (p: Promise<void>) => p.catch((e) => toast(`Échec : ${(e as Error).message}`, true));
  return (
    <ul className="adm-req-list">
      {list.map((r) => (
        <li key={r.id} className={`adm-req ${r.status}`}>
          <div className="adm-req-head">
            <span className={`adm-pill ${r.status === "fait" ? "ok" : r.status === "ouvert" ? "warm" : ""}`}>{REQ_LABEL[r.status]}</span>
            {showCard && <b>{r.cardName} <span className="muted small">({r.card})</span></b>}
            <span className="small muted">
              {r.name} · {r.at ? r.at.toDate().toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "…"}
            </span>
            <span className="grow" />
            {r.status === "ouvert" && <button className="adm-link" onClick={() => act(cancelRequest(r.id))}>Annuler</button>}
            {r.status === "annulé" && <button className="adm-link" onClick={() => act(reopenRequest(r.id))}>Rouvrir</button>}
          </div>
          <div className="adm-req-text">{r.text}</div>
          {r.reply && <div className="adm-req-reply">🤖 {r.reply}</div>}
        </li>
      ))}
    </ul>
  );
}
