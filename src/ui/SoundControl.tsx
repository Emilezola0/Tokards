import { useState } from "react";
import { setMuted, setVolume, sfx, useMuted, useVolume } from "./sfx";
import { setVoiceVolume, useVoiceVolume, voiceCount } from "./voice";

/** Bouton son : clic = couper / remettre, curseur = volume. */
export default function SoundControl() {
  const muted = useMuted();
  const volume = useVolume();
  const voice = useVoiceVolume();
  const [open, setOpen] = useState(false);
  const icon = muted || volume === 0 ? "🔇" : volume < 0.4 ? "🔈" : volume < 0.75 ? "🔉" : "🔊";
  return (
    <span className="sound-ctl" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="ghost" title={muted ? "Activer le son" : "Couper le son"} onClick={() => setMuted(!muted)}>{icon}</button>
      {open && (
        <span className="sound-pop panel">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            aria-label="Volume"
            onChange={(e) => {
              setVolume(Number(e.target.value) / 100);
              if (muted) setMuted(false);
            }}
            onPointerUp={() => sfx.coin(0)}
          />
          <span className="small muted">{muted ? "coupé" : `${Math.round(volume * 100)} %`}</span>
          <span className="small muted" title={voiceCount() ? `${voiceCount()} carte(s) ont une voiceline` : "Aucune voiceline installée pour l'instant"}>🗣 Voix</span>
          <input type="range" min={0} max={100} value={Math.round(voice * 100)} aria-label="Volume des voicelines" onChange={(e) => setVoiceVolume(Number(e.target.value) / 100)} />
          <span className="small muted">{Math.round(voice * 100)} %</span>
        </span>
      )}
    </span>
  );
}
