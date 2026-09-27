import { ArrowUpIcon, PlusIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, GALLERY, type Build } from "./api";
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

const BUILDER_LABELS: Record<string, string> = { holo: "Holo", demo: "Scripted demo", claude: "Claude" };

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
const MAX_ATTACHMENTS = 2;

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

interface Props {
  build: Build | null;
  loading: boolean;
  thinking: string;
  onCreate: (prompt: string, images: string[]) => Promise<void>;
  onSay: (text: string, images: string[]) => Promise<void>;
}

export function ChatPanel({ build, loading, thinking, onCreate, onSay }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const thought = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const busy = build?.status === "building";
  const waiting = useWaitingLine(busy);
  const changing = Boolean(build || loading);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [build?.messages.length, busy]);

  useEffect(() => {
    thought.current?.scrollTo({ top: thought.current.scrollHeight });
  }, [thinking]);

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
    if (!prompt || sending || (changing && (busy || !build))) return;
    setSending(true);
    setError("");
    try {
      await (changing ? onSay(prompt, attachments) : onCreate(prompt, attachments));
      setText("");
      setAttachments([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const who = (build && BUILDER_LABELS[build.builder]) ?? build?.builder ?? "Builder";

  return (
    <div className="chat">
      <div className="chat-log" ref={log}>
        {loading ? null : !build ? (
          <div className="chat-intro">
            <h2>What should we build?</h2>
            <p>Describe a model. The builder designs it in real LDraw bricks, step by step, while you watch.</p>
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
          build.messages.map((m) => (
            <div key={`${m.at}-${m.role}`} className={`msg ${m.role}`}>
              {m.text}
              {m.images?.map((src) => (
                <button key={src} className="msg-render" onClick={() => setOpened(src)} title="Open the render">
                  <img src={src} alt="The render Holo saw" />
                </button>
              ))}
            </div>
          ))
        )}
        {busy && (
          <div className="msg assistant thinking">
            <div className="thinking-head" title={`${who} is ${thinking ? "thinking" : "working"}`}>
              <span key={waiting} className="shimmer">
                {waiting}
              </span>
            </div>
            {thinking && (
              <div className="thinking-text" ref={thought}>
                {thinking}
              </div>
            )}
          </div>
        )}
      </div>
      {GALLERY && <p className="gallery-note">Read-only gallery. New builds run in the local app with Holo.</p>}
      {!GALLERY && (
        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
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
            placeholder={changing ? "Describe how to change it…" : "Describe what to build…"}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = imageFiles(e.clipboardData.files);
              if (!files.length) return;
              e.preventDefault();
              attach(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
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
            <button className="round send stop" title="Stop" aria-label="Stop" onClick={() => api.stop(build.id)}>
              <StopIcon size={12} weight="fill" />
            </button>
          ) : (
            <button
              className="round send"
              title="Send"
              aria-label="Send"
              disabled={!text.trim() || sending}
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
