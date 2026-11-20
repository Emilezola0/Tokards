import { useMuted } from "./sfx";
import { hasVoice, playVoice, setEachVolume, useEachVolume, useVoiceVolume } from "./voice";

/** Curseur de volume propre à un deck (`deck:<nom>`) ou à une carte (`<ID>`), gardé dans ce navigateur. */
export function VoiceVolume({ k, label, sample }: { k: string; label: string; sample?: () => void }) {
  const v = useEachVolume(k);
  return (
    <label className="voice-vol" title="Ce réglage s'ajoute au volume général des voix et reste sur cet appareil.">
      <span>🗣 {label}</span>
      <input
        type="range" min={0} max={100} value={Math.round(v * 100)} aria-label={label}
        onChange={(e) => setEachVolume(k, Number(e.target.value) / 100)}
        onPointerUp={sample} onKeyUp={sample}
      />
      <span className="small muted">{Math.round(v * 100)} %</span>
    </label>
  );
}

/** Bouton « écouter la voiceline » et volume de la carte, dans son détail (rien si la carte n'en a pas). */
export default function VoiceButton({ id }: { id: string }) {
  const muted = useMuted();
  const volume = useVoiceVolume();
  if (!hasVoice(id)) return null;
  const off = muted || !volume;
  return (
    <div className="voice-row">
      <button className="voice-btn" disabled={off} title={off ? "Le son ou les voix sont coupés" : "Écouter la voiceline de la carte"} onClick={() => playVoice(id)}>
        🔊 Écouter la voiceline
      </button>
      <VoiceVolume k={id} label="Volume de cette carte" sample={() => playVoice(id)} />
    </div>
  );
}
