import { DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useRef, useSyncExternalStore } from "react";
import { instructionsPdf, planPages } from "./instructions";
import type { Build, Piece } from "./model";

interface Job {
  key: string;
  controller: AbortController;
  /** Share of the pages drawn, from 0 to 1, until the file or an error. */
  progress: number;
  url: string | null;
  size: number;
  error: string | null;
}

/** The one PDF being made or kept, so reopening its build's instructions is instant. */
let job: Job | null = null;
const listeners = new Set<() => void>();
const set = (next: Job) => {
  job = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const keyOf = (build: Build) => `${build.id}:${build.revision}:${build.name}`;

function start(build: Build, describe: (piece: Piece) => string) {
  job?.controller.abort();
  if (job?.url) URL.revokeObjectURL(job.url);
  const key = keyOf(build);
  const controller = new AbortController();
  const current = () => job?.controller === controller;
  set({ key, controller, progress: 0, url: null, size: 0, error: null });
  instructionsPdf(build, describe, controller.signal, ({ done, total }) => {
    if (current()) set({ ...job!, progress: done / total });
  }).then(
    (pdf) => current() && set({ ...job!, url: URL.createObjectURL(pdf), size: pdf.size }),
    (e) => current() && set({ ...job!, error: e instanceof Error ? e.message : "The instructions could not be made." }),
  );
}

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

interface Props {
  build: Build;
  describe: (piece: Piece) => string;
  className?: string;
}

/** Makes the build's PDF as soon as it shows, with the progress in the button, then downloads it in one click. */
export function PdfButton({ build, describe, className = "primary" }: Props) {
  const key = keyOf(build);
  const shown = useSyncExternalStore(subscribe, () => job);
  useEffect(() => {
    if (job?.key !== key || job.error) start(build, describe);
  }, [key]);
  const made = shown?.key === key ? shown : null;

  if (made?.error)
    return (
      <div className="dialog-generation">
        <p role="alert" className="error-text">
          {made.error}
        </p>
        <button className={className} onClick={() => start(build, describe)}>
          Try again
        </button>
      </div>
    );
  if (made?.url)
    return (
      <a className={`button ${className}`} href={made.url} download={`${build.name} instructions.pdf`}>
        <DownloadSimpleIcon size={16} /> Download instructions (PDF){" "}
        <span className="button-note">{megabytes(made.size)}</span>
      </a>
    );
  const percent = Math.round((made?.progress ?? 0) * 100);
  return (
    <button
      className={`${className} progress-button`}
      disabled
      style={{ "--progress": `${percent}%` } as CSSProperties}
    >
      Making the instructions… {percent}%
    </button>
  );
}

/** The build's instructions as a PDF: a cover, a page per layer, then the parts list. */
export function InstructionsExport({ build, describe, onClose }: Omit<Props, "className"> & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pages = planPages(build).length;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog className="dialog" ref={dialog} aria-labelledby="instructions-title" onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <h2 id="instructions-title">Building instructions</h2>
          <p>
            A PDF of {pages.toLocaleString()} {pages === 1 ? "page" : "pages"} for{" "}
            {build.pieces.length.toLocaleString()} pieces. Each step goes from the bottom up, with its new pieces
            outlined and pictured. The parts list comes last.
          </p>
        </div>
        <button className="quiet icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <div className="dialog-generation">
        <PdfButton build={build} describe={describe} />
      </div>
    </dialog>
  );
}
