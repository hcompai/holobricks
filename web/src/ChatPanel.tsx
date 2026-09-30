import { ArrowUpIcon, PlusIcon, ShuffleIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Build } from "./model";
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

const WAITING = [
  "Sorting the parts bin",
  "Counting studs",
  "Studying the photos",
  "Hunting for the right slope",
  "Checking every join",
  "Stacking plates",
  "Snapping bricks together",
  "Walking around the model",
  "Measuring twice",
  "Rummaging for a 1x1 round",
  "Squinting at the render",
  "Lining up the courses",
  "Looking for gaps",
  "Trying another angle",
];
const WAITING_S = 4;
const TYPING_FRAMES = 60;
const MAX_ATTACHMENTS = 2;
const WHO = "Holo";
const PINNED_PX = 80;

/** A gallery image's small WebP; other images show as they are. */
const small = (src: string) => (src.startsWith("/gallery/") ? src.replace(/[^/]+$/, "small/$&.webp") : src);

/** A waiting line that changes every few seconds while `active`, never twice in a row. */
function useWaitingLine(active: boolean): string {
  const [line, setLine] = useState(() => Math.floor(Math.random() * WAITING.length));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(
      () => setLine((i) => (i + 1 + Math.floor(Math.random() * (WAITING.length - 1))) % WAITING.length),
      WAITING_S * 1000,
    );
    return () => clearInterval(timer);
  }, [active]);
  return WAITING[line];
}

function useTyped(text: string): string {
  const [typed, setTyped] = useState({ text, shown: 0 });
  useEffect(() => {
    const step = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? text.length
      : Math.ceil(text.length / TYPING_FRAMES);
    let shown = 0;
    let frame = 0;
    const tick = () => {
      shown = Math.min(text.length, shown + step);
      setTyped({ text, shown });
      if (shown < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return typed.text === text ? text.slice(0, typed.shown) : "";
}

interface Props {
  build: Build | null;
  loading: boolean;
  thinking: string;
  /** Why the builder takes no message here, or null when it does. */
  closed: ReactNode;
  onCreate: (prompt: string, images: string[]) => Promise<void>;
  onSay: (text: string, images: string[]) => Promise<void>;
  onStop: () => Promise<void>;
  /** Start a new build from a copy of this closed one, changed as asked. */
  onRemix: (text: string, images: string[]) => Promise<void>;
}

export function ChatPanel({ build, loading, thinking, closed, onCreate, onSay, onStop, onRemix }: Props) {
  const [text, setText] = useState("");
  const [remixing, setRemixing] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const thought = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrolled = useRef<string | null>(null);
  /** Whether the log sits at its end, so new lines scroll it and reading earlier ones is left alone. */
  const pinned = useRef(true);
  const busy = build?.status === "building";
  const waiting = useWaitingLine(busy);
  const typed = useTyped(thinking);
  const changing = Boolean(build || loading);
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

  useEffect(() => {
    thought.current?.scrollTo({ top: thought.current.scrollHeight });
  }, [typed]);

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
    if ((!prompt && !attachments.length) || sending || (changing && (busy || !build))) return;
    setSending(true);
    setError("");
    try {
      await (remixing ? onRemix : changing ? onSay : onCreate)(prompt, attachments);
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
          <div className="msg assistant thinking">
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
            <div key={i} className={`msg ${m.role}`}>
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
                  onClick={() => setOpened(src)}
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
          ))
        )}
        {busy && (
          <div className="msg assistant thinking">
            <div className="thinking-head" title={`${WHO} is ${thinking ? "thinking" : "working"}`}>
              <span key={waiting} className="shimmer">
                {waiting}
              </span>
            </div>
            {typed && (
              <div className="thinking-text" ref={thought}>
                {typed}
              </div>
            )}
          </div>
        )}
      </div>
      {closed && !remixing && (
        <div className="gallery-note">
          <p>{closed}</p>
          {!!build?.pieces.length && (
            <button onClick={() => setRemixing(true)} title="Start your own build from a copy of this one">
              <ShuffleIcon size={14} weight="bold" /> Remix
            </button>
          )}
        </div>
      )}
      {(!closed || remixing) && (
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
            autoFocus={remixing}
            placeholder={
              remixing
                ? `What should ${WHO} change?`
                : busy
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
