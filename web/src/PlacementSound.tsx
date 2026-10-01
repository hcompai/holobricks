import { SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import { placementSoundEnabled, subscribePlacementSound, togglePlacementSound } from "./brickAudio";

export function PlacementSoundToggle() {
  const sound = useSyncExternalStore(subscribePlacementSound, placementSoundEnabled);
  return (
    <button
      className="icon-button placement-sound"
      onClick={togglePlacementSound}
      aria-pressed={sound}
      aria-label={sound ? "Mute brick sounds" : "Enable brick sounds"}
      title={sound ? "Mute brick sounds" : "Enable brick sounds"}
    >
      {sound ? <SpeakerHighIcon size={16} weight="bold" /> : <SpeakerSlashIcon size={16} weight="bold" />}
    </button>
  );
}
