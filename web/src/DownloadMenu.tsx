import { CubeIcon, DownloadSimpleIcon, FilmStripIcon, ImageIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Build } from "./api";

interface Props {
  build: Build;
  image: () => Promise<Blob | null>;
  onReplay: () => void;
}

/** An icon button opening the build's downloads: the LDraw model, or the view as a PNG. */
export function DownloadMenu({ build, image, onReplay }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const save = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: `${build.name}.${extension}` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveImage = async () => {
    setOpen(false);
    const png = await image();
    if (png) save(png, "png");
  };

  return (
    <div className="menu" ref={root}>
      <button
        className={open ? "icon-button active" : "icon-button"}
        onClick={() => setOpen(!open)}
        title="Download"
        aria-label="Download"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DownloadSimpleIcon size={16} weight="bold" />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button
            role="menuitem"
            disabled={!build.ldr}
            onClick={() => {
              setOpen(false);
              save(new Blob([build.ldr], { type: "text/plain" }), "ldr");
            }}
          >
            <CubeIcon size={16} />
            Download .ldr
          </button>
          <button role="menuitem" onClick={saveImage}>
            <ImageIcon size={16} />
            Download image
          </button>
          <button
            role="menuitem"
            disabled={!build.pieces.length}
            onClick={() => {
              setOpen(false);
              onReplay();
            }}
          >
            <FilmStripIcon size={16} /> Export timeline film
          </button>
        </div>
      )}
    </div>
  );
}
