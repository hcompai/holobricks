import { CubeIcon, DownloadSimpleIcon, ImageIcon } from "@phosphor-icons/react";
import type { Build } from "./model";
import { useMenu } from "./useMenu";

interface Props {
  build: Build;
  image: () => Promise<Blob | null>;
}

/** An icon button opening the build's downloads: the LDraw model, or the view as a PNG. */
export function DownloadMenu({ build, image }: Props) {
  const { open, setOpen, root } = useMenu();

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
        </div>
      )}
    </div>
  );
}
