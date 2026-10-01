import { DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { instructionsPdf, planPages, type Progress } from "./instructions";
import type { Build, Piece } from "./model";

interface Props {
  build: Build;
  describe: (piece: Piece) => string;
  onClose: () => void;
}

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** Renders the build's instructions into a PDF, with progress and cancel, then offers the file. */
export function InstructionsExport({ build, describe, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const job = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [file, setFile] = useState<{ url: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = planPages(build).length;

  useEffect(() => {
    dialog.current?.showModal();
    return () => job.current?.abort();
  }, []);

  useEffect(() => () => (file ? URL.revokeObjectURL(file.url) : undefined), [file]);

  const generate = async () => {
    const controller = new AbortController();
    job.current = controller;
    setError(null);
    setFile(null);
    setProgress({ done: 0, total: 1, label: "Starting…" });
    try {
      const pdf = await instructionsPdf(build, describe, controller.signal, setProgress);
      setFile({ url: URL.createObjectURL(pdf), size: pdf.size });
    } catch (e) {
      if (controller.signal.aborted) setError("Cancelled. You can start again.");
      else setError(e instanceof Error ? e.message : "The instructions could not be made.");
    } finally {
      if (job.current === controller) job.current = null;
      setProgress(null);
    }
  };

  return (
    <dialog className="dialog" ref={dialog} aria-labelledby="instructions-title" onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <h2 id="instructions-title">Building instructions</h2>
          <p>
            A PDF of {pages.toLocaleString()} pages for {build.pieces.length.toLocaleString()} pieces. Each step goes
            from the bottom up, with its new pieces outlined and pictured. The parts list comes last.
          </p>
        </div>
        <button className="quiet icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <div className="dialog-generation" aria-live="polite">
        {progress ? (
          <>
            <progress value={progress.done} max={progress.total} aria-label="Instructions progress" />
            <div className="dialog-progress">
              <span>{progress.label}</span>
              <button onClick={() => job.current?.abort()}>Cancel</button>
            </div>
          </>
        ) : file ? (
          <div className="dialog-actions">
            <span>{megabytes(file.size)}</span>
            <a className="button primary" href={file.url} download={`${build.name} instructions.pdf`}>
              <DownloadSimpleIcon size={16} /> Download PDF
            </a>
          </div>
        ) : (
          <button className="primary" onClick={generate}>
            Make the PDF
          </button>
        )}
        {error && (
          <div role="alert" className="error-text">
            {error}
          </div>
        )}
      </div>
    </dialog>
  );
}
