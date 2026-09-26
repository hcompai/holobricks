import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, GALLERY, type Build } from "./api";

const SUGGESTIONS = [
  "A red-and-white lighthouse",
  "A tiny cottage with a garden",
  "A retro rocket",
  "A friendly robot",
  "A pine tree",
];

const BUILDER_LABELS: Record<string, string> = { holo: "Holo", demo: "Scripted demo", claude: "Claude" };

interface Props {
  build: Build | null;
  thinking: string;
  onCreate: (prompt: string, builder: string) => Promise<void>;
  onSay: (text: string) => Promise<void>;
}

export function ChatPanel({ build, thinking, onCreate, onSay }: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"change" | "new">("change");
  const [builders, setBuilders] = useState<string[]>([]);
  const [builder, setBuilder] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const thought = useRef<HTMLDivElement>(null);
  const busy = build?.status === "building";
  const target = build && mode === "change" ? "change" : "new";

  useEffect(() => {
    if (GALLERY) return;
    api.builders().then((list) => {
      setBuilders(list);
      setBuilder((b) => b || list[0] || "");
    }, console.error);
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [build?.messages.length, busy]);

  useEffect(() => {
    thought.current?.scrollTo({ top: thought.current.scrollHeight });
  }, [thinking]);

  const send = async (value = text) => {
    const prompt = value.trim();
    if (!prompt || sending || (busy && target === "change")) return;
    setSending(true);
    setError("");
    try {
      await (target === "change" ? onSay(prompt) : onCreate(prompt, builder));
      setText("");
      setMode("change");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const who = BUILDER_LABELS[build?.builder ?? builder] ?? build?.builder ?? "Builder";

  return (
    <div className="chat">
      <div className="chat-log" ref={log}>
        {!build ? (
          <div className="chat-intro">
            <h2>What should we build?</h2>
            <p>Describe a model. The builder designs it in real LDraw bricks, step by step, while you watch.</p>
            <div className="label">Try one</div>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          build.messages.map((m) => (
            <div key={`${m.at}-${m.role}`} className={`msg ${m.role}`}>
              {m.text}
              {m.images?.length > 0 && (
                <div className={`msg-images n${m.images.length}`}>
                  {m.images.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt="" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="msg assistant thinking">
            <div className="thinking-head">
              <span className="pulse" />
              {who} is {thinking ? "thinking" : "working"}…
            </div>
            {thinking && (
              <div className="thinking-text" ref={thought}>
                {thinking}
              </div>
            )}
          </div>
        )}
      </div>
      {GALLERY ? (
        <p className="gallery-note">Read-only gallery. New builds run in the local app with Holo.</p>
      ) : (
        <div className="composer">
          <div className="modes">
            {build && (
              <>
                <button className={mode === "change" ? "active" : ""} onClick={() => setMode("change")}>
                  Change this build
                </button>
                <button className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>
                  Start a new build
                </button>
              </>
            )}
            {target === "new" && builders.length > 1 && (
              <select className="builder-select" value={builder} onChange={(e) => setBuilder(e.target.value)}>
                {builders.map((b) => (
                  <option key={b} value={b}>
                    {BUILDER_LABELS[b] ?? b}
                  </option>
                ))}
              </select>
            )}
          </div>
          <textarea
            value={text}
            placeholder={target === "change" ? "Describe how to change it…" : "Describe what to build…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy && build && target === "change" ? (
            <button className="send stop" onClick={() => api.stop(build.id)}>
              <StopIcon size={14} weight="fill" />
              Stop
            </button>
          ) : (
            <button className="send" disabled={!text.trim() || sending} onClick={() => send()}>
              Send
              <ArrowUpIcon size={14} weight="bold" />
            </button>
          )}
          {error && <p className="composer-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
