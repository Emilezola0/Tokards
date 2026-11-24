import { useEffect, useMemo, useState } from "react";
import { CARDS, DECKS, PLACEHOLDER, cardImage, defaultCardImage, tagIcons, type Tags } from "../data/cards";
import { CONTENT, ORIGINAL_CARDS, type CardEdit } from "../data/overrides";
import CardView from "../ui/CardView";
import { defaultVoiceUrl, voiceUrl } from "../ui/voice";
import { SCRIPTS } from "../effects/scripts";
import { deleteAsset, prepareAudio, prepareImage, saveCard, uploadAsset } from "./api";
import { DropZone, Field, SaveBar, confirmLeave, useToast } from "./bits";

type FileDraft = { blob: Blob; url: string } | "reset" | "mute" | null;
type Draft = { name: string; text: string; rules: string; tags: Tags; img: FileDraft; voice: FileDraft };

const TAGS: { k: keyof Tags; label: string }[] = [
  { k: "sentience", label: "🧠 Sentience" },
  { k: "gold", label: "💰 Gold" },
  { k: "blackHole", label: "🌀 Trou noir" },
];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
const playUrl = (url: string | null) => url && void new Audio(url).play().catch(() => {});

function draftOf(id: string): Draft {
  const c = CARDS[id];
  return { name: c.name, text: c.text, rules: c.rules ?? "", tags: { ...c.tags }, img: null, voice: null };
}

export default function CardsTab({ rev }: { rev: number }) {
  const [deck, setDeck] = useState<string>(DECKS.find((d) => d.inGame && d.name !== "BASE")?.name ?? "");
  const [q, setQ] = useState("");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return Object.values(CARDS)
      .filter((c) => (!deck || c.deck === deck) && (!onlyEdited || CONTENT.cards?.[c.id]))
      .filter((c) => !n || `${c.id} ${c.name} ${c.text}`.toLowerCase().includes(n))
      .sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id, "fr", { numeric: true }) : a.kind === "card" ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, q, onlyEdited, rev]);

  const pick = (id: string | null) => {
    if (id === sel || !confirmLeave(dirty)) return;
    setDirty(false);
    setSel(id);
  };
  const edited = Object.keys(CONTENT.cards ?? {}).length;

  return (
    <div className="adm-split">
      <section className="adm-list-pane">
        <div className="adm-toolbar">
          <input className="adm-search" placeholder="🔎 Chercher une carte (nom, ID, texte)…" value={q} onChange={(e) => setQ(e.target.value)} />
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
              <span className="adm-tile-name">{c.name}</span>
              <span className="adm-tile-id">{c.id}</span>
            </button>
          ))}
          {!list.length && <p className="muted">Aucune carte ne correspond.</p>}
        </div>
      </section>
      <section className="adm-edit-pane">
        {sel ? (
          <CardEditor key={`${sel}`} id={sel} rev={rev} onDirty={setDirty} />
        ) : (
          <div className="adm-empty">
            <div className="adm-empty-icon">🃏</div>
            <h2>Choisis une carte</h2>
            <p className="muted">Clique sur une carte à gauche pour changer son nom, son texte, son image ou sa voiceline.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function CardEditor({ id, rev, onDirty }: { id: string; rev: number; onDirty: (d: boolean) => void }) {
  const toast = useToast();
  const orig = ORIGINAL_CARDS[id];
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
      for (const [k, label] of [["name", "nom"], ["text", "texte"], ["rules", "précisions"], ["tags", "tags"]] as const)
        if (!same(next[k], edit[k])) changed.push(label);
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
      await saveCard(id, next, `Carte « ${next.name ?? orig.name} » (${id}) : ${changed.join(", ") || "mise à jour"}`);
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
  return (
    <div className="adm-editor">
      <header className="adm-editor-head">
        <div>
          <div className="adm-kicker">{c.deck === "BASE" ? "Base" : c.deck} · {id} · {c.kind === "victory" ? "Condition de victoire" : "Carte"}</div>
          <h2>{d.name || <i className="muted">Sans nom</i>}</h2>
        </div>
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
          {(c.trigger || c.event) && (
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
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onCancel={() => setD(draftOf(id))} />
    </div>
  );
}
