import { useMuted } from "./sfx";
import { hasVoice, playVoice, useVoiceVolume } from "./voice";

/** Bouton « écouter la voiceline » dans le détail d'une carte (rien si la carte n'en a pas). */
export default function VoiceButton({ id }: { id: string }) {
  const muted = useMuted();
  const volume = useVoiceVolume();
  if (!hasVoice(id)) return null;
  const off = muted || !volume;
  return (
    <button className="voice-btn" disabled={off} title={off ? "Le son ou les voix sont coupés" : "Écouter la voiceline de la carte"} onClick={() => playVoice(id)}>
      🔊 Écouter la voiceline
    </button>
  );
}
