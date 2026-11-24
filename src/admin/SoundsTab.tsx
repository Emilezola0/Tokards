import { useState } from "react";
import { CUSTOM_URLS } from "../data/cards";
import { CONTENT } from "../data/overrides";
import { SFX_LABELS, previewFile, synth, useMuted, type SfxName } from "../ui/sfx";
import { deleteAsset, prepareAudio, saveSfx, uploadAsset } from "./api";
import { DropZone, fmtDate, useToast } from "./bits";

export default function SoundsTab({ rev }: { rev: number }) {
  void rev;
  const toast = useToast();
  const muted = useMuted();
  const [busy, setBusy] = useState<string | null>(null);
  const names = Object.keys(SFX_LABELS) as SfxName[];

  const upload = async (name: SfxName, f: File) => {
    setBusy(name);
    try {
      const at = await uploadAsset(`sfx~${name}`, prepareAudio(f));
      await saveSfx(name, at, `Son « ${SFX_LABELS[name]} » remplacé (${f.name})`);
      toast("Son enregistré ✔");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    } finally {
      setBusy(null);
    }
  };
  const reset = async (name: SfxName) => {
    setBusy(name);
    try {
      await deleteAsset(`sfx~${name}`);
      await saveSfx(name, undefined, `Son « ${SFX_LABELS[name]} » remis à l'origine`);
      toast("Son d'origine remis ✔");
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <h2>🔊 Sons du jeu</h2>
          <p className="muted">
            Les sons d'origine sont fabriqués par le navigateur. Tu peux remplacer chacun par un fichier (MP3 conseillé, court, 700 Ko max).
            Les voicelines des cartes se changent dans l'onglet <b>Cartes</b>.
          </p>
          {muted && <p className="adm-pill bad">🔇 Le son du jeu est coupé : les sons d'origine ne joueront pas dans l'aperçu.</p>}
        </div>
      </header>
      <div className="adm-sound-list">
        {names.map((n) => {
          const at = CONTENT.sfx?.[n];
          const url = CUSTOM_URLS[`sfx~${n}`];
          return (
            <div key={n} className={`adm-sound ${at ? "custom" : ""}`}>
              <div className="adm-sound-name">
                <b>{SFX_LABELS[n]}</b>
                <span className="small muted">{at ? `Fichier personnalisé · ${fmtDate(at)}` : "Son d'origine"}</span>
              </div>
              <button title="Écouter le son d'origine" onClick={() => (synth[n] as () => void)()}>▶ Origine</button>
              <button title="Écouter le fichier personnalisé" disabled={!url} onClick={() => url && previewFile(url)}>▶ Perso</button>
              <DropZone accept="audio/*,.mp3,.ogg,.wav,.m4a,.webm" label={busy === n ? "⏳ Envoi…" : at ? "🎵 Changer" : "🎵 Remplacer"} onFile={(f) => upload(n, f)} compact />
              <button className="adm-link" disabled={!at || busy === n} onClick={() => reset(n)}>↺ Origine</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
