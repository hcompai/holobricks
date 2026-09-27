import { CopyIcon, DownloadSimpleIcon, ShareNetworkIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, type Build, type FilmJob } from "./api";
import { FilmRenderer } from "./film";
import { encodeGif } from "./filmGif";
import {
  brandable,
  FILM_ASPECTS,
  FILM_SECONDS,
  filmCaption,
  filmFilename,
  HOLO_MODEL,
  type FilmAspect,
  type FilmOptions,
} from "./filmPlan";

/** The long side of the preview and of GIFs made in the browser. */
const BROWSER_SIDE = 640;
const BROWSER_FPS = 20;
const BROWSER_BUDGET_MS = 30000;
const BROWSER_MOST_SAMPLES = 8;
const PREVIEW_SAMPLES = 4;
const POLL_MS = 1000;

type Engine = "server" | "browser";

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
  const [engine, setEngine] = useState<Engine | null>(null);
  const [aspect, setAspect] = useState<FilmAspect>("16:9");
  const [seconds, setSeconds] = useState(20);
  const [branded, setBranded] = useState(brandable(build));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [film, setFilm] = useState<FilmJob | null>(null);
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
    setFilm(null);
  };

  useEffect(() => {
    dialog.current?.showModal();
    let current = true;
    void api.filmsUnavailable().then((reason) => current && setEngine(reason ? "browser" : "server"));
    return () => {
      current = false;
      job.current?.abort();
    };
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

  const renderOnServer = async (signal: AbortSignal) => {
    let current = await api.createFilm(build.id, { aspect, seconds, branded });
    signal.addEventListener("abort", () => void api.cancelFilm(current.id), { once: true });
    while (current.status === "queued" || current.status === "rendering" || current.status === "encoding") {
      setProgress(current.progress);
      setStatus(
        current.status === "queued"
          ? "Waiting for another film…"
          : current.status === "encoding"
            ? "Encoding MP4 and GIF…"
            : `Rendering… ${Math.round(current.progress * 100)}%`,
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      signal.throwIfAborted();
      current = await api.film(current.id);
    }
    if (current.status !== "done") throw new Error(current.error ?? "The film could not be rendered.");
    setFilm(current);
  };

  const renderInBrowser = async (signal: AbortSignal) => {
    const r = renderer.current!;
    try {
      r.configure(browserOptions(aspect, seconds, branded, 1));
      r.calibrate(BROWSER_BUDGET_MS, BROWSER_MOST_SAMPLES);
      const blob = await encodeGif(r, BROWSER_FPS, signal, (value) => {
        setProgress(value);
        setStatus(`Creating GIF… ${Math.round(value * 100)}%`);
      });
      signal.throwIfAborted();
      setFile(new File([blob], filmFilename(build.name, "gif"), { type: "image/gif" }));
    } finally {
      if (renderer.current === r) preview();
    }
  };

  const generate = async () => {
    if (!renderer.current || !ready || busy || !engine) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setStatus("");
    setFile(null);
    setFilm(null);
    setError("");
    setNotice("");
    try {
      await (engine === "server" ? renderOnServer : renderInBrowser)(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not make the film.");
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

  const mp4 = film?.files.mp4;
  const gif = film?.files.gif;
  return (
    <dialog className="film-dialog" ref={dialog} aria-labelledby="film-title" onCancel={onClose}>
      <div className="film-heading">
        <div>
          <h2 id="film-title">Share the build</h2>
          <p>
            {engine === "server"
              ? "Render a film of the build: an MP4 for video, a GIF for posts."
              : "Turn the timeline into a looping GIF."}
          </p>
        </div>
        <button className="icon-button" aria-label="Close export" onClick={onClose}>
          <XIcon size={20} />
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
          <canvas ref={canvas} hidden={!!url || !!film || !ready} aria-label="Film preview" />
          {url && <img src={url} alt={`Film of ${build.name}`} />}
          {film && mp4 && (
            <video
              src={api.filmUrl(film.id, "mp4")}
              aria-label={`Film of ${build.name}`}
              autoPlay
              muted
              loop
              playsInline
            />
          )}
          {!ready && <span>{error ? "Preview unavailable" : "Loading the bricks…"}</span>}
        </div>
        <div className="film-controls">
          <p className="film-context">
            {build.status === "building" ? "A snapshot of the build in progress. " : "A snapshot of this model. "}
            Replays saved assembly steps, not the agent’s working history.
          </p>
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
                <input type="checkbox" checked={branded} onChange={(e) => update(setBranded, e.target.checked)} />
                {HOLO_MODEL} / H Company branding
              </label>
            )}
          </fieldset>
          <p className="small muted">Bricks drop in step by step, then the finished model takes a full turn.</p>
          <div className="film-generation" aria-live="polite">
            {busy ? (
              <>
                <progress value={progress} max={1} aria-label="Film progress" />
                <div className="film-progress-row">
                  <span>{status || "Starting…"}</span>
                  <button
                    onClick={() => {
                      job.current?.abort();
                      setNotice("Export cancelled. You can start it again.");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="film-primary" disabled={!ready || !engine} onClick={generate}>
                {engine === "server"
                  ? film
                    ? "Render again"
                    : "Render MP4 + GIF"
                  : file
                    ? "Generate again"
                    : "Generate GIF"}
              </button>
            )}
            {error && (
              <div role="alert" className="film-error">
                {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              </div>
            )}
          </div>
          {film && (
            <div className="film-result">
              <p>
                {film.options.width} × {film.options.height} · {film.options.fps} fps · {film.samples} samples per frame
              </p>
              <div className="film-actions">
                {mp4 && (
                  <a className="film-primary" href={api.filmUrl(film.id, "mp4")} download>
                    <DownloadSimpleIcon size={16} /> Download MP4 · {megabytes(mp4.size)}
                  </a>
                )}
                {gif && (
                  <a href={api.filmUrl(film.id, "gif")} download>
                    <DownloadSimpleIcon size={16} /> Download GIF · {megabytes(gif.size)}
                  </a>
                )}
              </div>
              {gif && (
                <p className="small muted">
                  GIF: {gif.width} × {gif.height} at {gif.fps} fps, under 15 MB for X. Use the MP4 wherever video works.
                </p>
              )}
            </div>
          )}
          {file && url && (
            <div className="film-result">
              <p>
                {browserOptions(aspect, seconds, branded, 1).width} ×{" "}
                {browserOptions(aspect, seconds, branded, 1).height} · {seconds}s · {megabytes(file.size)}
              </p>
              <div className="film-actions">
                <a className="film-primary" href={url} download={file.name}>
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
