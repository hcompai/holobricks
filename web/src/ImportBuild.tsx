import { UploadSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { importModel, type ModelFile, readModel } from "./library";

/** Import a model file as a public build of the signed-in user: pick it, confirm, and it opens once imported. */
export function ImportBuild({ onImported }: { onImported: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState<ModelFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    try {
      setModel(await readModel(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file could not be read.");
    }
  };

  const confirm = async () => {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      const id = await importModel(model);
      setModel(null);
      onImported(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="import-build">
      <button onClick={() => input.current?.click()} disabled={busy}>
        <UploadSimpleIcon size={14} weight="bold" /> Import a build
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,.gz,application/json,application/gzip"
        hidden
        aria-label="Model file to import"
        onChange={(e) => chosen(e.target.files?.[0])}
      />
      {model && (
        <div className="import-confirm" role="dialog" aria-label="Import a build">
          <span>
            Import <b>{model.name}</b> ({model.pieces.length.toLocaleString()} pieces)? It will be public in the
            library, under your name; its parts list stays unverified.
          </span>
          <button className="primary" onClick={confirm} disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </button>
          <button onClick={() => setModel(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="import-error">
          {error}
        </p>
      )}
    </div>
  );
}
