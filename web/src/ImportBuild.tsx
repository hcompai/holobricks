import { UploadSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Confirm } from "./Confirm";
import { importModel, type ModelFile, readModel } from "./library";
import { useMenu } from "./useMenu";

/** Import a model file as a public build of the signed-in user: pick it, confirm, and it opens once imported. */
export function ImportBuild({ onImported }: { onImported: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { open, setOpen, root } = useMenu();
  const [model, setModel] = useState<ModelFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    try {
      setModel(await readModel(file));
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file could not be read.");
    }
  };

  return (
    <div className="import-build">
      {error && (
        <span role="alert" className="error-text small">
          {error}
        </span>
      )}
      <div className="menu" ref={root}>
        <button className="quiet" onClick={() => input.current?.click()}>
          <UploadSimpleIcon size={16} /> Import
        </button>
        {open && model && (
          <Confirm
            name="Import"
            question={`Import ${model.name}?`}
            note={`Its ${model.pieces.length.toLocaleString()} pieces go public in the library under your name, with an unverified parts list.`}
            doing="Importing…"
            icon={<UploadSimpleIcon size={16} />}
            action={async () => onImported(await importModel(model))}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,.gz,application/json,application/gzip"
        hidden
        aria-label="Model file to import"
        onChange={(e) => chosen(e.target.files?.[0])}
      />
    </div>
  );
}
