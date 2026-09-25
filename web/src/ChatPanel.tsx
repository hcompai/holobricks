import { useEffect, useRef, useState } from "react";
import type { Build } from "./api";

const SUGGESTIONS = [
  "A red-and-white lighthouse",
  "A tiny cottage with a garden",
  "A retro rocket",
  "A friendly robot",
  "A pine tree",
];

interface Props {
  build: Build | null;
  onCreate: (prompt: string) => void;
  onSay: (text: string) => void;
}

export function ChatPanel({ build, onCreate, onSay }: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"change" | "new">("change");
  const log = useRef<HTMLDivElement>(null);
  const busy = build?.status === "building";
  const target = build && mode === "change" ? "change" : "new";

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [build?.messages.length]);

  const send = (value = text) => {
    const prompt = value.trim();
    if (!prompt || (busy && target === "change")) return;
    if (target === "change") onSay(prompt);
    else onCreate(prompt);
    setText("");
    setMode("change");
  };

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
            </div>
          ))
        )}
        {busy && <div className="msg assistant typing">Building…</div>}
      </div>
      <div className="composer">
        {build && (
          <div className="modes">
            <button className={mode === "change" ? "active" : ""} onClick={() => setMode("change")}>
              Change this build
            </button>
            <button className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>
              Start a new build
            </button>
          </div>
        )}
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
        <button className="send" disabled={!text.trim() || (busy && target === "change")} onClick={() => send()}>
          Send →
        </button>
      </div>
    </div>
  );
}
