import { ArrowUpIcon, PlusIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Build, Message, Work } from "./model";
import type { Activity } from "./session";
import { Lightbox } from "./Lightbox";
import { imageFiles, reference } from "./references";

const SUGGESTIONS = [
  {
    label: "A red-and-white lighthouse",
    prompt:
      "A tall red-and-white striped lighthouse on a rocky headland. A lantern room of glass under a black dome, a gallery with a railing, small windows climbing the tower. Beside it a keeper's cottage with a slate roof and a smoking chimney. Jagged grey rocks drop into a dark sea with white surf; a stone stair winds down to a wooden jetty with a moored rowing boat, lobster pots and coiled rope. Tufts of grass and wildflowers in the crevices, gulls on the railing.",
  },
  {
    label: "A tiny cottage with a garden",
    prompt:
      "A tiny thatched cottage in an overgrown garden. Whitewashed walls with dark timber beams, a thick sagging thatch roof with a brick chimney, small leaded windows with flower boxes, a red front door under a rose arch. A crooked flagstone path winds through beds of lavender, hollyhocks and foxgloves to a picket gate in a low dry-stone wall. An apple tree heavy with fruit, a wooden bench, a birdbath, a wheelbarrow and a vegetable patch at the back.",
  },
  {
    label: "A retro rocket",
    prompt:
      "A 1950s retro rocket on its launch pad, ready to go. A tall, slender red-and-white fuselage with a pointed nose cone, round portholes and chrome bands, three swept fins standing on landing legs. Beside it a steel lattice gantry tower with a crew access arm, ladders and floodlights. Fuel pipes and tanks, yellow-and-black warning stripes on the pad, a small concrete control bunker with a radar dish, and a crew van parked nearby.",
  },
  {
    label: "A friendly robot",
    prompt:
      "A friendly retro robot standing in a cluttered tinkerer's workshop. A boxy light grey body, a round head with two big glowing blue eyes and an antenna tipped with a red light, a chest panel of colored buttons and dials, jointed arms with claw hands holding a wrench, and tank treads for feet. Around it a workbench covered with tools, gears and a desk lamp, shelves of spare parts, a potted plant and a small robot dog.",
  },
  {
    label: "A pine tree",
    prompt:
      "A towering old pine in a snowy forest clearing. A thick trunk with rough bark and roots gripping mossy boulders, layered dark green boughs tapering to a sharp top, dusted with snow and hung with pine cones. At its foot a small log cabin with a smoking chimney and a woodpile, a frozen stream crossed by stepping stones, a fox and a deer at the edge of the clearing, and young saplings and rocks all around.",
  },
];

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

function Live({ activity }: { activity: Activity }) {
  const label = useSteady(activity.label);
  const elapsed = useNow() - activity.since;
  const head = (
    <span className="live-head">
      <span key={label} className="shimmer">
        {label}
      </span>
      {elapsed >= CLOCK_MS && <span className="live-clock">{clock(elapsed)}</span>}
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
  onOpen: (src: string) => void;
}

const Row = memo(
  function Row({ message: m, entering, onOpen }: RowProps) {
    return (
      <div className={`msg ${m.role}${entering ? " enter" : ""}`}>
        {m.work && <WorkLog work={m.work} summary={`Worked for ${duration(m.work.end - m.work.start)}`} />}
        {m.role === "assistant" ? (
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
          </div>
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
    a.message.text === b.message.text &&
    a.message.role === b.message.role &&
    a.message.work?.end === b.message.work?.end &&
    a.message.images.join() === b.message.images.join(),
);

interface Props {
  build: Build | null;
  loading: boolean;
  activity: Activity | null;
  /** Why the builder takes no message here, or null when it does. */
  closed: ReactNode;
  preview?: ReactNode;
  onCreate: (prompt: string, images: string[]) => Promise<void>;
  onSay: (text: string, images: string[]) => Promise<void>;
  onStop: () => Promise<void>;
  onFork: () => void;
}

export function ChatPanel({ build, loading, activity, closed, preview, onCreate, onSay, onStop, onFork }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrolled = useRef<string | null>(null);
  /** Whether the log sits at its end, so new lines scroll it and reading earlier ones is left alone. */
  const pinned = useRef(true);
  const busy = build?.status === "building";
  const changing = Boolean(build || loading);
  /** How many messages the build had when it opened: only later ones animate in. */
  const first = useRef<{ id: string | null; count: number }>({ id: null, count: 0 });
  if (build && first.current.id !== build.id) first.current = { id: build.id, count: build.messages.length };
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);

  useEffect(() => {
    const jump = scrolled.current !== (build?.id ?? null);
    scrolled.current = build?.id ?? null;
    if (jump) pinned.current = true;
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight, behavior: jump ? "instant" : "smooth" });
  }, [build?.id, build?.messages.length, busy]);

  const home = !build && !loading;
  useEffect(() => {
    if (home) input.current?.focus();
  }, [home]);

  const attach = async (files: File[]) => {
    if (!files.length) return;
    try {
      const added = await Promise.all(files.map(reference));
      setAttachments((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      setError(`Could not read that image: ${e instanceof Error ? e.message : e}`);
    }
  };

  const send = async () => {
    const prompt = text.trim();
    if (preview || closed || (!prompt && !attachments.length) || sending || (changing && (busy || !build))) return;
    setSending(true);
    setError("");
    try {
      await (changing ? onSay : onCreate)(prompt, attachments);
      setText("");
      setAttachments([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

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
        ) : !build ? (
          <div className="chat-intro">
            <h2>What should we build?</h2>
            <p>Describe a model. {WHO} designs it in real bricks, step by step, while you watch.</p>
            <div className="label">Try one</div>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setText(s.prompt);
                    input.current?.focus();
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          build.messages.map((m, i) => (
            <Row key={i} message={m} entering={i >= first.current.count} onOpen={setOpened} />
          ))
        )}
        {busy && activity && <Live activity={activity} />}
      </div>
      {home && <p className="tab-hint">Keep this tab open while Holo builds: your browser provides the renders.</p>}
      {preview && <div className="preview-note">{preview}</div>}
      {closed && !preview && (
        <div className="gallery-note">
          <div>{closed}</div>
          {!!build?.pieces.length && <button onClick={onFork}>Fork</button>}
        </div>
      )}
      {!closed && !preview && (
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
            placeholder={
              busy
                ? `${WHO} is building: Stop to change course`
                : changing
                  ? "Describe how to change it…"
                  : "Describe what to build…"
            }
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
          {busy && build ? (
            <button
              className="round send stop"
              title={stopping ? "Stopping after this step" : "Stop"}
              aria-label="Stop"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                onStop().catch((e) => {
                  setStopping(false);
                  setError(`Could not stop: ${e instanceof Error ? e.message : e}`);
                });
              }}
            >
              <StopIcon size={12} weight="fill" />
            </button>
          ) : (
            <button
              className="round send"
              title="Send"
              aria-label="Send"
              disabled={(!text.trim() && !attachments.length) || sending}
              onClick={send}
            >
              <ArrowUpIcon size={14} weight="bold" />
            </button>
          )}
        </div>
      )}
      {error && <p className="composer-error">{error}</p>}
      <Lightbox src={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
