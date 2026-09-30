import {
  BookOpenIcon,
  CheckIcon,
  CubeIcon,
  ExportIcon,
  FilmStripIcon,
  ImageIcon,
  LinkIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Build } from "./model";
import { useMenu } from "./useMenu";

const COPIED_MS = 2000;

interface Props {
  build: Build;
  /** The link anyone can open, or null while the build is private. */
  link: string | null;
  loading: boolean;
  image: () => Promise<Blob | null>;
  onGif: () => void;
  onInstructions: () => void;
}

/** Every way to take the build elsewhere: its link, a GIF, instructions, the model file or an image. */
export function ShareMenu({ build, link, loading, image, onGif, onInstructions }: Props) {
  const { open, setOpen, root } = useMenu();
  const [copied, setCopied] = useState(false);
  const built = build.pieces.length > 0;
  const exportable = built && !loading;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => link && navigator.clipboard.writeText(link).then(() => setCopied(true), console.error);

  const save = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: `${build.name}.${extension}` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const then = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="menu" ref={root}>
      <button
        className={open ? "active" : ""}
        onClick={() => setOpen(!open)}
        disabled={!built && !link}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ExportIcon size={16} />
        <span className="button-label">Share</span>
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {link && (
            <>
              <button role="menuitem" onClick={copy}>
                {copied ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
                {copied ? "Link copied" : "Copy link"}
              </button>
              <hr />
            </>
          )}
          <button role="menuitem" disabled={!exportable} onClick={then(onGif)}>
            <FilmStripIcon size={16} />
            Share a GIF…
          </button>
          <button role="menuitem" disabled={!exportable} onClick={then(onInstructions)}>
            <BookOpenIcon size={16} />
            Instructions (PDF)…
          </button>
          <hr />
          <button
            role="menuitem"
            disabled={!build.ldr}
            onClick={then(() => save(new Blob([build.ldr], { type: "text/plain" }), "ldr"))}
          >
            <CubeIcon size={16} />
            Download model (.ldr)
          </button>
          <button
            role="menuitem"
            disabled={!built}
            onClick={then(() => void image().then((png) => png && save(png, "png")))}
          >
            <ImageIcon size={16} />
            Download image
          </button>
        </div>
      )}
    </div>
  );
}
