import { FilmStripIcon, ShoppingBagIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import type { Build } from "./model";
import type { Publishing } from "./ShareMenu";
import { VisibilityToggle } from "./VisibilityToggle";

/** Over the model once Holo finishes: what to do with the build, starting with who can see it. */
export function FinishedCard({
  build,
  publishing,
  onGif,
  onShop,
  onClose,
}: {
  build: Build;
  publishing: Publishing;
  onGif: () => void;
  onShop: (() => void) | null;
  onClose: () => void;
}) {
  const pieces = build.pieces.length;
  return (
    <section className="finished-card" aria-label="Build finished">
      <SparkleIcon className="finished-icon" size={20} weight="fill" aria-hidden="true" />
      <div className="finished-text">
        <b>{build.name} is ready</b>
        <span>
          {pieces} {pieces === 1 ? "piece" : "pieces"} ·{" "}
          {publishing.published ? "in the public library" : "only you can see it"}
        </span>
      </div>
      <div className="finished-actions">
        <VisibilityToggle publishing={publishing} name={build.name} />
        <button onClick={onGif} title="Share a GIF">
          <FilmStripIcon size={16} />
          <span className="button-label">GIF</span>
        </button>
        {onShop && (
          <button onClick={onShop} title="Buy bricks">
            <ShoppingBagIcon size={16} />
            <span className="button-label">Buy bricks</span>
          </button>
        )}
      </div>
      <button className="quiet icon-button" aria-label="Dismiss" onClick={onClose}>
        <XIcon size={16} />
      </button>
    </section>
  );
}
