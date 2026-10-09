import { useCallback, useEffect, useState } from "react";
import { current, key } from "./account";
import { track } from "./analytics";

const API = "/api/hearts";

export interface Hearts {
  counts: Record<string, number>;
  mine: Set<string>;
}

const EMPTY: Hearts = { counts: {}, mine: new Set() };
const signed = () => ({ Authorization: `Bearer ${current()?.pass}`, "X-Agents-Key": key() });

async function fetchHearts(): Promise<Hearts> {
  const response = await fetch(current() ? `${API}?t=${Date.now()}` : API, { headers: current() ? signed() : {} });
  if (!response.ok) throw new Error(`Hearts are unavailable (HTTP ${response.status}).`);
  const { counts, mine } = (await response.json()) as { counts: Record<string, number>; mine: string[] };
  return { counts, mine: new Set(mine) };
}

async function setHeart(id: string, on: boolean) {
  const response = await fetch(on ? API : `${API}?id=${encodeURIComponent(id)}`, {
    method: on ? "PUT" : "DELETE",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: on ? JSON.stringify({ id }) : undefined,
  });
  if (!response.ok) throw new Error(`Couldn't save the heart (HTTP ${response.status}).`);
}

/** Everyone's hearts on public builds, and a toggle that shows at once and settles with the server. */
export function useHearts(me: string | null, onSignIn?: () => void) {
  const [hearts, setHearts] = useState<Hearts>(EMPTY);
  useEffect(() => {
    let live = true;
    fetchHearts().then((h) => live && setHearts(h), console.error);
    return () => {
      live = false;
    };
  }, [me]);
  const toggle = useCallback(
    (id: string) => {
      if (!me) return onSignIn?.();
      const on = !hearts.mine.has(id);
      const flip = (h: Hearts, to: boolean): Hearts => {
        const mine = new Set(h.mine);
        if (to) mine.add(id);
        else mine.delete(id);
        return { counts: { ...h.counts, [id]: Math.max(0, (h.counts[id] ?? 0) + (to ? 1 : -1)) }, mine };
      };
      setHearts((h) => flip(h, on));
      setHeart(id, on).then(
        () => track("build_liked", { liked: on }),
        (e) => {
          console.error(e);
          setHearts((h) => flip(h, !on));
        },
      );
    },
    [me, hearts.mine, onSignIn],
  );
  return { hearts, toggle };
}
