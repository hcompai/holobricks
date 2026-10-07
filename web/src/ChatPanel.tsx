import { ThinkingIcon } from "./Thinking";
import { ArrowUpIcon, PlusIcon, ShuffleIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { memo, type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Build, Message, Work } from "./model";
import type { Activity } from "./session";
import { Lightbox } from "./Lightbox";
import { imageFiles, reference } from "./references";
import { label, SUGGESTIONS } from "./suggestions";
import { HOLO } from "./holo";

const MAX_ATTACHMENTS = 2;
const WHO = "Holo";
const PINNED_PX = 80;
/** How long a live label stays before the next one replaces it, so quick steps never flicker. */
const DWELL_MS = 900;
/** How long a phase lasts before the chat shows its clock. */
const CLOCK_MS = 5000;

/** A gallery image's small WebP; other images show as they are. */
const small = (src: string) => (src.startsWith("/gallery/") ? src.replace(/[^/]+$/, "small/$&.webp") : src);

function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `label`, held for at least `DWELL_MS` before it changes. */
function useSteady(label: string): string {
  const [shown, setShown] = useState(label);
  const changed = useRef(0);
  useEffect(() => {
    if (label === shown) return;
    const timer = setTimeout(
      () => {
        changed.current = Date.now();
        setShown(label);
      },
      Math.max(0, changed.current + DWELL_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [label, shown]);
  return shown;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The builder's steps, drawn only while open: a long build reasons for pages. */
function WorkLog({ work, summary }: { work: Work; summary: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="work" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && (
        <ol className="work-steps">
          {work.steps.map((s, i) => (
            <li key={i}>
              {s.reasoning && <p>{s.reasoning}</p>}
              {s.actions.map((a, j) => (
                <span key={j} className="work-action">
                  {a}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** What the builder does now; no clock before the first bricks, which take minutes of setup. */
function Live({ activity, early }: { activity: Activity; early: boolean }) {
  const label = useSteady(activity.label);
  const elapsed = useNow() - activity.since;
  const head = (
    <span className="live-head">
      <ThinkingIcon label={label} />
      <span key={label} className="shimmer">
        {label}
      </span>
      {!early && elapsed >= CLOCK_MS && <span className="live-clock">{clock(elapsed)}</span>}
    </span>
  );
  return (
    <div className="msg assistant live" title={`${WHO} is working`}>
      {activity.work ? <WorkLog work={activity.work} summary={head} /> : head}
    </div>
  );
}

interface RowProps {
  message: Message;
  entering: boolean;
  /** Sent to the builder, which has not read it yet. */
  queued?: boolean;
  onOpen: (src: string) => void;
}

const Row = memo(
  function Row({ message: m, entering, queued, onOpen }: RowProps) {
    return (
      <div
        className={`msg ${m.role}${entering ? " enter" : ""}${queued ? " queued" : ""}`}
        title={queued ? `Sent: ${WHO} reads it at its next step` : undefined}
      >
        {m.work && <WorkLog work={m.work} summary={`Worked for ${duration(m.work.end - m.work.start)}`} />}
        {m.role === "assistant" ? (
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
          </div>
        ) : m.role === "tool" ? (
          <details className="work">
            <summary>{WHO} checked it</summary>
            <p className="work-steps">{m.text}</p>
          </details>
        ) : m.role === "user" ? (
          (label(m.text) ?? m.text)
        ) : (
          m.text
        )}
        {m.images?.map((src) => (
          <button
            key={src}
            className="msg-render"
            onClick={() => onOpen(src)}
            title={m.role === "user" ? "Open the image" : "Open the render"}
          >
            <img
              src={small(src)}
              alt={m.role === "user" ? "Your reference image" : `The render ${WHO} saw`}
              loading="lazy"
              decoding="async"
            />
          </button>
        ))}
      </div>
    );
  },
  (a, b) =>
    a.entering === b.entering &&
    a.queued === b.queued &&
    a.message.text === b.message.text &&
    a.message.role === b.message.role &&
    a.message.work?.end === b.message.work?.end &&
    a.message.images.join() === b.message.images.join(),
);

export interface ChatHandle {
  ask: (prompt: string, attached: Record<string, Blob>) => Promise<boolean>;
}

interface Props {
  ref?: Ref<ChatHandle>;
  build: Build | null;
  loading: boolean;
  activity: Activity | null;
  /** Why the builder takes no message here, or null when it does. */
  closed: ReactNode;
  onCreate: (prompt: string, images: string[]) => Promise<void>;
  onSay: (text: string, images: string[], attached?: Record<string, Blob>) => Promise<void>;
  onStop: () => Promise<void>;
  preview?: ReactNode;
  onFork: () => void;
  /** Receives the notes and composer under the chat log, which a phone's sheet keeps in view. */
  dockRef?: (dock: HTMLDivElement | null) => void;
  /** Start a new build from a copy of this one, changed as asked: a closed build, or one whose session ended. */
  onRemix: (text: string, images: string[], attached?: Record<string, Blob>) => Promise<void>;
}

export function ChatPanel({
  ref,
  build,
  loading,
  activity,
  closed,
  onCreate,
  onSay,
  onStop,
  onRemix,
  preview,
  onFork,
  dockRef,
}: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  /** Messages sent to the builder that its chat does not show yet, each with how many user messages it showed then. */
  const [queued, setQueued] = useState<{ message: Message; heard: number }[]>([]);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrolled = useRef<string | null>(null);
  /** Whether the log sits at its end, so new lines scroll it and reading earlier ones is left alone. */
  const pinned = useRef(true);
  const busy = build?.status === "building";
  /** The builder no longer takes messages here: a change starts a copy of the build. */
  const ended = !!build && !build.open && !busy;
  const changing = Boolean(build || loading);
  /** How many messages the build had when it opened: only later ones animate in. */
  const first = useRef<{ id: string | null; count: number }>({ id: null, count: 0 });
  if (build && first.current.id !== build.id) first.current = { id: build.id, count: build.messages.length };
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);

  const heard = build?.messages.filter((m) => m.role === "user").length ?? 0;
  const waiting = queued.length ? queued.slice(Math.max(0, heard - queued[0].heard)) : queued;
  useEffect(() => {
    if (queued.length && !waiting.length) setQueued([]);
  }, [queued.length, waiting.length]);

  useEffect(() => {
    const jump = scrolled.current !== (build?.id ?? null);
    scrolled.current = build?.id ?? null;
    if (jump) pinned.current = true;
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight, behavior: jump ? "instant" : "smooth" });
  }, [build?.id, build?.messages.length, busy, waiting.length]);

  const home = !build && !loading;

  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [home]);
  useEffect(() => {
    if (home) input.current?.focus();
  }, [home]);

  const attach = async (files: File[]) => {
    if (!files.length) return;
    try {
      const added = await Promise.all(files.map(reference));
      setAttachments((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      setError(`Could not read that image: ${message(e)}`);
    }
  };

  /** Hand `prompt` to the builder, even mid-build; whether it took it. */
  const deliver = async (prompt: string, images: string[], attached: Record<string, Blob> = {}) => {
    const saying = !!build && !ended;
    const entry = { message: { role: "user" as const, text: prompt, images }, heard };
    if (saying) setQueued((list) => [...list, entry]);
    setSending(true);
    setError("");
    try {
      if (ended) await onRemix(prompt, images, attached);
      else if (saying) await onSay(prompt, images, attached);
      else await onCreate(prompt, images);
      return true;
    } catch (e) {
      setQueued((list) => list.filter((q) => q !== entry));
      setError(message(e));
      return false;
    } finally {
      setSending(false);
    }
  };

  useImperativeHandle(ref, () => ({
    ask: (prompt, attached) => {
      if (closed || preview || sending || !build?.id) return Promise.resolve(false);
      return deliver(prompt, [], attached);
    },
  }));

  const typed = !!(text.trim() || attachments.length);
  const unsendable = !!preview || !!closed || !typed || sending || (changing && !build?.id);
  /** The composer empties at once, and gets its text and images back if the builder does not take them. */
  const send = async () => {
    if (unsendable) return;
    const prompt = text.trim();
    const images = attachments;
    setText("");
    setAttachments([]);
    if (await deliver(prompt, images)) return;
    setText((typed) => typed || prompt);
    setAttachments((added) => (added.length ? added : images));
  };

  const composer = !closed && !preview && (
    <div
      className={dragging ? "composer dragging" : "composer"}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        attach(imageFiles(e.dataTransfer.files));
      }}
    >
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((src, i) => (
            <div key={i} className="attachment">
              <img src={src} alt={`Reference ${i + 1}`} />
              <button
                title="Remove"
                aria-label="Remove image"
                onClick={() => setAttachments((current) => current.filter((_, j) => j !== i))}
              >
                <XIcon size={10} weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        value={text}
        placeholder={changing ? "Ask for a change" : "A red lighthouse on a rock… or drop a photo"}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = imageFiles(e.clipboardData.files);
          if (!files.length) return;
          e.preventDefault();
          attach(files);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <input
        ref={picker}
        type="file"
        aria-label="Photos to attach"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          attach(imageFiles(e.target.files));
          e.target.value = "";
        }}
      />
      <button
        className="round attach"
        title="Attach reference images"
        aria-label="Attach reference images"
        disabled={attachments.length >= MAX_ATTACHMENTS}
        onClick={() => picker.current?.click()}
      >
        <PlusIcon size={14} weight="bold" />
      </button>
      <span className="composer-model" aria-label={`Model: ${HOLO.name}`}>
        {HOLO.name}
      </span>
      {busy && build && !typed ? (
        <button
          className="round send stop"
          title={stopping ? "Stopping after this step" : "Stop"}
          aria-label="Stop"
          disabled={stopping || sending}
          onClick={() => {
            setStopping(true);
            onStop().catch((e) => {
              setStopping(false);
              setError(`Could not stop: ${message(e)}`);
            });
          }}
        >
          <StopIcon size={12} weight="fill" />
        </button>
      ) : (
        <button className="round send" title="Send" aria-label="Send" disabled={unsendable} onClick={send}>
          <ArrowUpIcon size={14} weight="bold" />
        </button>
      )}
    </div>
  );
  const failure = error && <p className="error-text composer-error">{error}</p>;

  if (home)
    return (
      <div className="home-intro">
        <h1>What should we build?</h1>
        <p>Describe anything you like and {WHO} will build it in real bricks while you watch.</p>
        {composer}
        {failure}
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} disabled={sending} onClick={() => deliver(s.prompt, [])}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="chat">
      <div
        className="chat-log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_PX;
        }}
      >
        {loading ? (
          <div className="msg assistant live">
            <span className="shimmer">Opening the chat…</span>
          </div>
        ) : (
          build?.messages.map((m, i) => (
            <Row key={i} message={m} entering={i >= first.current.count} onOpen={setOpened} />
          ))
        )}
        {busy && build && activity && <Live activity={activity} early={!build.pieces.length} />}
        {waiting.map((q, i) => (
          <Row key={`queued-${i}`} message={q.message} entering queued onOpen={setOpened} />
        ))}
      </div>
      <div className="chat-dock" ref={dockRef}>
        {preview && <div className="preview-note">{preview}</div>}
        {closed && !preview && (
          <div className="gallery-note">
            <div>{closed}</div>
            {!!build?.pieces.length && (
              <button onClick={onFork} title="Start your own build from a copy of this one">
                <ShuffleIcon size={14} weight="bold" /> Fork
              </button>
            )}
          </div>
        )}
        {composer}
        {failure}
      </div>
      <Lightbox src={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
