import { CopyIcon, DownloadSimpleIcon, ShareNetworkIcon, XIcon, XLogoIcon } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { BrickLoader } from "./BrickLoader";
import type { Build } from "./model";
import { FilmRenderer } from "./film";
import { encodeGif } from "./filmGif";
import { PHONE } from "./usePhone";
import {
  brandable,
  FILM_ASPECTS,
  FILM_SECONDS,
  filmCaption,
  filmFilename,
  type FilmAspect,
  type FilmCamera,
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

function browserOptions(
  aspect: FilmAspect,
  seconds: number,
  branded: boolean,
  samples: number,
  camera: FilmCamera,
): FilmOptions {
  const { width, height } = FILM_ASPECTS[aspect];
  const scale = BROWSER_SIDE / Math.max(width, height);
  const even = (v: number) => 2 * Math.round((v * scale) / 2);
  return { width: even(width), height: even(height), seconds, fps: BROWSER_FPS, samples, branded, camera };
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Makes the GIF as soon as the bricks load, and again whenever an option changes. */
export function FilmExport({ build, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<FilmRenderer | null>(null);
  /** The GIF being made; the next waits for it to stop, since both draw with the one renderer. */
  const queue = useRef(Promise.resolve());
  const [aspect, setAspect] = useState<FilmAspect>(() => (PHONE.matches ? "1:1" : "16:9"));
  const [seconds, setSeconds] = useState(8);
  const [camera, setCamera] = useState<FilmCamera>("follow");
  const [branded, setBranded] = useState(brandable(build));
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const caption = filmCaption(build, branded);
  const size = FILM_ASPECTS[aspect];
  const made = browserOptions(aspect, seconds, branded, 1, camera);
  const canShare = !!file && !!navigator.share && !!navigator.canShare?.({ files: [file] });

  useEffect(() => {
    dialog.current?.showModal();
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
      engine?.dispose();
      renderer.current = null;
    };
  }, [build, retry]);

  /** The finished model as the film ends. */
  const preview = () => {
    const r = renderer.current;
    if (!r) return;
    r.configure(browserOptions(aspect, seconds, branded, PREVIEW_SAMPLES, camera));
    r.render(r.frames - 1);
  };

  const generate = async (signal: AbortSignal) => {
    const r = renderer.current;
    if (signal.aborted || !r) return;
    setProgress(0);
    setFile(null);
    setError("");
    setNotice("");
    try {
      r.configure(browserOptions(aspect, seconds, branded, 1, camera));
      r.calibrate(BROWSER_BUDGET_MS, BROWSER_MOST_SAMPLES);
      const blob = await encodeGif(r, BROWSER_FPS, signal, setProgress);
      signal.throwIfAborted();
      setFile(new File([blob], filmFilename(build.name, "gif"), { type: "image/gif" }));
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : "Could not make the GIF.");
    } finally {
      if (renderer.current === r) preview();
    }
  };

  useEffect(() => {
    if (!ready) return;
    preview();
    const controller = new AbortController();
    queue.current = queue.current.then(() => generate(controller.signal));
    return () => controller.abort();
  }, [ready, aspect, seconds, branded, camera]);

  const share = async () => {
    if (!file || !canShare) return;
    setNotice("");
    try {
      await navigator.share({ files: [file], title: build.name, text: caption });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setNotice("Sharing is unavailable here. Download the GIF and attach it to your post.");
      }
    }
  };

  const postOnX = () => {
    if (!file || !url) return;
    Object.assign(document.createElement("a"), { href: url, download: file.name }).click();
    window.open(
      `https://x.com/intent/tweet?${new URLSearchParams({ text: caption })}`,
      "_blank",
      "noopener,noreferrer",
    );
    setNotice("Attach the downloaded GIF to your post.");
  };

  const percent = Math.round(progress * 100);

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
          aria-busy={!url}
        >
          <canvas ref={canvas} hidden={!!url || !ready} aria-label="Film preview" />
          {url && <img src={url} alt={`Film of ${build.name}`} />}
          {!ready && (error ? <span>Preview unavailable</span> : <BrickLoader label="Loading the bricks…" />)}
        </div>
        <div className="film-controls">
          <div className="dialog-generation" aria-live="polite">
            {file && url ? (
              <>
                <div className="dialog-actions">
                  <button className="primary" onClick={postOnX}>
                    <XLogoIcon size={16} /> Post on X
                  </button>
                  {canShare && (
                    <button onClick={share}>
                      <ShareNetworkIcon size={16} /> Share…
                    </button>
                  )}
                  <a className="button" href={url} download={file.name}>
                    <DownloadSimpleIcon size={16} /> Download GIF
                  </a>
                </div>
                <p className="small muted">Attach the downloaded GIF on X.</p>
                <p className="small muted">
                  {made.width} × {made.height} · {seconds}s · {megabytes(file.size)}
                </p>
              </>
            ) : error ? (
              <div role="alert" className="error-text">
                {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              </div>
            ) : (
              <button
                className="primary progress-button"
                disabled
                style={{ "--progress": `${percent}%` } as CSSProperties}
              >
                {ready ? `Making the GIF… ${percent}%` : "Loading the bricks…"}
              </button>
            )}
          </div>
          <details className="film-options">
            <summary>Options</summary>
            <label>
              Camera
              <select value={camera} onChange={(e) => setCamera(e.target.value as FilmCamera)}>
                <option value="follow">Follow build</option>
                <option value="orbit">Orbit</option>
                <option value="fixed">Fixed</option>
              </select>
            </label>
            <label>
              Format
              <select value={aspect} onChange={(e) => setAspect(e.target.value as FilmAspect)}>
                {Object.entries(FILM_ASPECTS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Duration
              <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {FILM_SECONDS.map((s) => (
                  <option key={s} value={s}>
                    {s} seconds
                  </option>
                ))}
              </select>
            </label>
            {brandable(build) && (
              <label className="film-branding">
                <input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} />H Company
                credit
              </label>
            )}
          </details>
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
