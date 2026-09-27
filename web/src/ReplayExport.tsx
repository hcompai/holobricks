import { CopyIcon, DownloadSimpleIcon, ShareNetworkIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Build } from "./api";
import { ReplayRenderer } from "./replay";
import {
  brandable,
  HOLO_MODEL,
  REPLAY_FORMATS,
  REPLAY_SECONDS,
  replayCaption,
  replayFilename,
  type ReplayFormat,
} from "./replayPlan";
import type { View } from "./scene";

interface Props {
  /** Frozen at open, including during a live run. */
  build: Build;
  onClose: () => void;
}

export function ReplayExport({ build, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReplayRenderer | null>(null);
  const job = useRef<AbortController | null>(null);
  const [format, setFormat] = useState<ReplayFormat>("square");
  const [view, setView] = useState<View>("iso");
  const [seconds, setSeconds] = useState(12);
  const [branded, setBranded] = useState(brandable(build));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const caption = replayCaption(build, branded);
  const size = REPLAY_FORMATS[format];
  const canShare = !!file && !!navigator.canShare?.({ files: [file] });
  const update = <T,>(set: (value: T) => void, value: T) => {
    set(value);
    setFile(null);
  };

  useEffect(() => {
    dialog.current?.showModal();
    return () => job.current?.abort();
  }, []);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const controller = new AbortController();
    let engine: ReplayRenderer | null = null;
    setReady(false);
    setFile(null);
    setError("");
    setNotice("");
    const timer = setTimeout(() => {
      controller.abort();
      engine?.dispose();
      setError("Loading the model timed out. Check the connection and retry.");
    }, 45000);
    try {
      engine = new ReplayRenderer(canvas.current!, build, controller.signal);
      renderer.current = engine;
      void engine
        .prepare()
        .then(() => {
          if (!controller.signal.aborted) setReady(true);
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load this model.");
        })
        .finally(() => clearTimeout(timer));
    } catch (e) {
      clearTimeout(timer);
      setError(e instanceof Error ? e.message : "WebGL is unavailable in this browser.");
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
      job.current?.abort();
      engine?.dispose();
      renderer.current = null;
    };
  }, [build, retry]);

  useEffect(() => {
    if (ready) renderer.current?.setFormat(format);
  }, [ready, format]);

  useEffect(() => {
    if (ready) renderer.current?.setView(view);
  }, [ready, view]);

  useEffect(() => {
    if (ready) renderer.current?.preview(branded);
  }, [ready, format, view, branded]);

  const generate = async () => {
    if (!renderer.current || !ready || busy) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setFile(null);
    setError("");
    setNotice("");
    try {
      const blob = await renderer.current.encode(seconds, branded, controller.signal, setProgress);
      controller.signal.throwIfAborted();
      setFile(new File([blob], replayFilename(build.name), { type: "image/gif" }));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not generate the GIF.");
    } finally {
      if (job.current === controller) {
        job.current = null;
        setBusy(false);
      }
    }
  };

  const share = async () => {
    if (!file || !canShare) return;
    try {
      await navigator.share({ files: [file], title: build.name, text: caption });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setNotice("Sharing is unavailable here. Download the GIF and attach it to your post.");
      }
    }
  };

  return (
    <dialog className="replay-dialog" ref={dialog} aria-labelledby="replay-title" onCancel={onClose}>
      <div className="replay-heading">
        <div>
          <h2 id="replay-title">Share the build</h2>
          <p>Turn the timeline into a looping GIF.</p>
        </div>
        <button className="icon-button" aria-label="Close export" onClick={onClose}>
          <XIcon size={20} />
        </button>
      </div>
      <div className="replay-layout">
        <div
          className="replay-preview"
          style={{ aspectRatio: `${size.width}/${size.height}` }}
          aria-busy={!ready || busy}
        >
          <canvas ref={canvas} hidden={!!url || !ready} aria-label="Assembly replay preview" />
          {url && <img src={url} alt={`Assembly replay of ${build.name}`} />}
          {!ready && <span>{error ? "Preview unavailable" : "Loading the bricks…"}</span>}
        </div>
        <div className="replay-controls">
          <p className="replay-context">
            {build.status === "building" ? "A snapshot of the build in progress. " : "A snapshot of this model. "}
            Replays saved assembly steps, not the agent’s working history.
          </p>
          <fieldset disabled={busy}>
            <legend className="sr-only">GIF settings</legend>
            <label>
              Format
              <select value={format} onChange={(e) => update(setFormat, e.target.value as ReplayFormat)}>
                {Object.entries(REPLAY_FORMATS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Duration
              <select value={seconds} onChange={(e) => update(setSeconds, Number(e.target.value))}>
                {REPLAY_SECONDS.map((s) => (
                  <option key={s} value={s}>
                    {s} seconds
                  </option>
                ))}
              </select>
            </label>
            <label>
              Camera
              <select value={view} onChange={(e) => update(setView, e.target.value as View)}>
                <option value="iso">Front three-quarter</option>
                <option value="isoBack">Back three-quarter</option>
                <option value="front">Front</option>
                <option value="top">Top</option>
              </select>
            </label>
            {brandable(build) && (
              <label className="replay-branding">
                <input type="checkbox" checked={branded} onChange={(e) => update(setBranded, e.target.checked)} />
                {HOLO_MODEL} / H Company branding
              </label>
            )}
          </fieldset>
          <p className="small muted">
            Includes a 3-second spin of the complete snapshot, ending with a 1-second front view.
          </p>
          <div className="replay-generation" aria-live="polite">
            {busy ? (
              <>
                <progress value={progress} max={1} aria-label="GIF generation" />
                <div className="replay-progress-row">
                  <span>Creating GIF… {Math.round(progress * 100)}%</span>
                  <button
                    onClick={() => {
                      job.current?.abort();
                      setNotice("Export cancelled. You can generate it again.");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="replay-primary" disabled={!ready} onClick={generate}>
                {file ? "Generate again" : "Generate GIF"}
              </button>
            )}
            {error && (
              <div role="alert" className="replay-error">
                {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              </div>
            )}
          </div>
          {file && url && (
            <div className="replay-result">
              <p>
                {size.width} × {size.height} · {seconds}s · {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
              <div className="replay-actions">
                <a className="replay-primary" href={url} download={file.name}>
                  <DownloadSimpleIcon size={16} /> Download GIF
                </a>
                {canShare && (
                  <button onClick={share}>
                    <ShareNetworkIcon size={16} /> Share…
                  </button>
                )}
              </div>
              <p className="small muted">
                {canShare
                  ? "Choose an app in the share sheet, or download to attach to a post."
                  : "Download and attach to your social post. File sharing is unavailable in this browser."}{" "}
                Some platforms may require a video instead.
              </p>
            </div>
          )}
          <label className="replay-caption">
            Suggested caption
            <textarea value={caption} readOnly rows={4} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="replay-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(caption);
                setNotice("Caption copied.");
              } catch {
                setNotice("Select the caption above and copy it manually.");
              }
            }}
          >
            <CopyIcon size={16} /> Copy caption
          </button>
          {notice && (
            <p className="small" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
