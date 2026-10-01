import { useEffect, useRef, useState } from "react";
import { download } from "./agent";
import { buildRevision } from "./buildRevision";
import type { Model } from "./model";
import { unpack, type ModelAttachment } from "./session";

export interface Version {
  id: string;
  number: number;
  at: string;
  model: Model;
}

/** A name or refreshed shopping quote does not make a new design. Assembly changes do. */
export const design = (model: Model) => `${model.revision}:${JSON.stringify(model.steps)}`;

export async function savedModel(blob: Blob): Promise<Model> {
  const model = await unpack<Model>(blob);
  if (
    !model ||
    !Array.isArray(model.pieces) ||
    !Array.isArray(model.steps) ||
    !model.parts ||
    (await buildRevision(model.pieces)) !== model.revision
  )
    throw new Error("Invalid saved model");
  return model;
}

/** Read attachments only on demand. Never skip a failed download and silently renumber later versions. */
export function useHistory(id: string | null, attachments: ModelAttachment[], seed: Model | null, enabled: boolean) {
  const [state, setState] = useState<{ id: string | null; versions: Version[]; count: number; error: boolean }>({
    id: null,
    versions: [],
    count: 0,
    error: false,
  });
  const [retry, setRetry] = useState(0);
  const cache = useRef<{ id: string | null; models: Map<string, Model> }>({ id: null, models: new Map() });
  useEffect(() => {
    if (!id || !enabled) return;
    if (cache.current.id !== id) cache.current = { id, models: new Map() };
    const models = cache.current.models;
    const controller = new AbortController();
    const load = async () => {
      const versions: Version[] = seed ? [{ id: "seed", number: 1, at: "", model: seed }] : [];
      for (const attachment of attachments) {
        let model = models.get(attachment.url);
        if (!model) {
          model = await savedModel(await download(attachment.url, controller.signal));
          models.set(attachment.url, model);
        }
        if (
          (!versions.length && !model.pieces.length) ||
          (versions.length && design(versions.at(-1)!.model) === design(model))
        )
          continue;
        versions.push({ id: attachment.url, number: versions.length + 1, at: attachment.at, model });
      }
      if (!controller.signal.aborted) setState({ id, versions, count: attachments.length, error: false });
    };
    void load().catch(() => {
      if (!controller.signal.aborted) setState((old) => ({ ...old, id, error: true }));
    });
    return () => controller.abort();
  }, [id, attachments, seed, enabled, retry]);
  const current = state.id === id;
  return {
    versions: current ? state.versions : [],
    loading: enabled && (!current || state.count !== attachments.length) && !(current && state.error),
    error: current && state.error,
    retry: () => {
      setState((old) => ({ ...old, error: false }));
      setRetry((n) => n + 1);
    },
  };
}
