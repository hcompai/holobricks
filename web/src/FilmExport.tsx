import { CopyIcon, DownloadSimpleIcon, ShareNetworkIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BrickLoader } from "./BrickLoader";
import type { Build } from "./model";
import { FilmRenderer } from "./film";
import { encodeGif } from "./filmGif";
import {
  brandable,
  FILM_ASPECTS,
  FILM_SECONDS,
  filmCaption,
  filmFilename,
  type FilmAspect,
  type FilmOptions,
} from "./filmPlan";

/** The long side of the preview and of GIFs made in the browser. */
const BROWSER_SIDE = 640;
const BROWSER_FPS = 20;
const BROWSER_BUDGET_MS = 30000;
const BROWSER_MOST_SAMPLES = 8;
const PREVIEW_SAMPLES = 4;

interface Props {
  /** Frozen at open, including during a live run. */
  build: Build;
  onClose: () => void;
}

function browserOptions(aspect: FilmAspect, seconds: number, branded: boolean, samples: number): FilmOptions {
  const { width, height } = FILM_ASPECTS[aspect];
  const scale = BROWSER_SIDE / Math.max(width, height);
  const even = (v: number) => 2 * Math.round((v * scale) / 2);
  return { width: even(width), height: even(height), seconds, fps: BROWSER_FPS, samples, branded };
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function FilmExport({ build, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<FilmRenderer | null>(null);
  const job = useRef<AbortController | null>(null);
  const [aspect, setAspect] = useState<FilmAspect>("16:9");
  const [seconds, setSeconds] = useState(8);
  const [branded, setBranded] = useState(brandable(build));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const caption = filmCaption(build, branded);
  const size = FILM_ASPECTS[aspect];
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
    let engine: FilmRenderer | null = null;
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
      engine = new FilmRenderer(build, canvas.current!, controller.signal);
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

  /** The finished model as the film ends. */
  const preview = () => {
    const r = renderer.current;
    if (!r) return;
    r.configure(browserOptions(aspect, seconds, branded, PREVIEW_SAMPLES));
    r.render(r.frames - 1);
  };

  useEffect(() => {
    if (ready) preview();
  }, [ready, aspect, seconds, branded]);

  const renderInBrowser = async (signal: AbortSignal) => {
    const r = renderer.current!;
    try {
      r.configure(browserOptions(aspect, seconds, branded, 1));
      r.calibrate(BROWSER_BUDGET_MS, BROWSER_MOST_SAMPLES);
      const blob = await encodeGif(r, BROWSER_FPS, signal, (value) => {
        setProgress(value);
        setStatus(`Making the GIF… ${Math.round(value * 100)}%`);
      });
      signal.throwIfAborted();
      setFile(new File([blob], filmFilename(build.name, "gif"), { type: "image/gif" }));
    } finally {
      if (renderer.current === r) preview();
    }
  };

  const generate = async () => {
    if (!renderer.current || !ready || busy) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setStatus("");
    setFile(null);
    setError("");
    setNotice("");
    try {
      await renderInBrowser(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not make the GIF.");
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
    <dialog className="dialog film-dialog" ref={dialog} aria-labelledby="film-title" onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <h2 id="film-title">Share a GIF</h2>
          <p>
            Bricks drop in step by step, then the model takes a full turn.
            {build.status === "building" && " It shows the build so far."}
          </p>
        </div>
        <button className="quiet icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <div className="film-layout">
        <div
          className="film-preview"
          style={{
            aspectRatio: `${size.width}/${size.height}`,
            width: `min(100%, ${(68 * size.width) / size.height}dvh)`,
          }}
          aria-busy={!ready || busy}
        >
          <canvas ref={canvas} hidden={!!url || !ready} aria-label="Film preview" />
          {url && <img src={url} alt={`Film of ${build.name}`} />}
          {!ready && (error ? <span>Preview unavailable</span> : <BrickLoader label="Loading the bricks…" />)}
        </div>
        <div className="film-controls">
          <fieldset disabled={busy}>
            <legend className="sr-only">Film settings</legend>
            <label>
              Format
              <select value={aspect} onChange={(e) => update(setAspect, e.target.value as FilmAspect)}>
                {Object.entries(FILM_ASPECTS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Duration
              <select value={seconds} onChange={(e) => update(setSeconds, Number(e.target.value))}>
                {FILM_SECONDS.map((s) => (
                  <option key={s} value={s}>
                    {s} seconds
                  </option>
                ))}
              </select>
            </label>
            {brandable(build) && (
              <label className="film-branding">
                <input type="checkbox" checked={branded} onChange={(e) => update(setBranded, e.target.checked)} />H
                Company logo
              </label>
            )}
          </fieldset>
          <div className="dialog-generation" aria-live="polite">
            {busy ? (
              <>
                <progress value={progress} max={1} aria-label="Film progress" />
                <div className="dialog-progress">
                  <span>{status || "Starting…"}</span>
                  <button
                    onClick={() => {
                      job.current?.abort();
                      setNotice("Cancelled. You can start again.");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="primary" disabled={!ready} onClick={generate}>
                {file ? "Make it again" : "Make the GIF"}
              </button>
            )}
            {error && (
              <div role="alert" className="error-text">
                {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              </div>
            )}
          </div>
          {file && url && (
            <div className="film-result">
              <p>
                {browserOptions(aspect, seconds, branded, 1).width} ×{" "}
                {browserOptions(aspect, seconds, branded, 1).height} · {seconds}s · {megabytes(file.size)}
              </p>
              <div className="dialog-actions">
                <a className="button primary" href={url} download={file.name}>
                  <DownloadSimpleIcon size={16} /> Download GIF
                </a>
                {canShare && (
                  <button onClick={share}>
                    <ShareNetworkIcon size={16} /> Share…
                  </button>
                )}
              </div>
              <p className="small muted">
                {canShare ? "Share it to an app, or download it for a post." : "Download it and attach it to a post."}
              </p>
            </div>
          )}
          <label className="film-caption">
            Suggested caption
            <textarea value={caption} readOnly rows={4} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="film-copy"
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
