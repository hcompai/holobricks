import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { forkOperation, forkSeed, type ForkOrigin } from "./fork";
import type { Build } from "./model";
import { imageFiles, reference } from "./references";

interface Props {
  build: Build;
  origin: ForkOrigin;
  onCreated: (id: string) => void;
  onClose: () => void;
}

export function ForkDialog({ build, origin, onCreated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(`${build.name.slice(0, 70)} · Fork`);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const operation = useRef(forkOperation());
  const pending = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const submit = async () => {
    if (pending.current || reading || photoError || !name.trim() || !text.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await operation.current(forkSeed(build, origin, name.trim()), text.trim(), photos);
      onCreated(id);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Couldn't start the fork.";
      setError(reason);
      setUncertain(reason.startsWith("Start unconfirmed"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="fork-dialog"
      aria-labelledby="fork-title"
      onCancel={(e) => {
        if (pending.current) e.preventDefault();
        else onClose();
      }}
    >
      <div className="history-heading">
        <h2 id="fork-title">Fork{origin.version ? ` V${origin.version}` : ""}</h2>
        <span className="spacer" />
        <button className="icon-button" aria-label="Close fork" disabled={busy} onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <p className="muted">New model · Starts at V1</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Name
          <input
            value={name}
            maxLength={80}
            required
            disabled={busy || uncertain}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          What should change?
          <textarea
            autoFocus
            value={text}
            required
            disabled={busy || uncertain}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="small muted">
          References · Optional
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy || uncertain || reading}
            onChange={async (e) => {
              const files = imageFiles(e.target.files).slice(0, 2);
              setReading(true);
              setPhotoError("");
              setPhotos([]);
              try {
                setPhotos(await Promise.all(files.map(reference)));
              } catch {
                setPhotoError("Couldn't read that image. Choose it again.");
              } finally {
                setReading(false);
              }
            }}
          />
        </label>
        {!!photos.length && (
          <div className="fork-photos">
            {photos.map((src, index) => (
              <img src={src} key={index} alt={`Reference ${index + 1}`} />
            ))}
          </div>
        )}
        {(error || photoError) && (
          <p className="composer-error" role="alert">
            {error || photoError}
          </p>
        )}
        <div className="fork-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {uncertain ? "Close" : "Cancel"}
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || reading || !!photoError || !name.trim() || !text.trim()}
          >
            {busy ? "Starting…" : uncertain ? "Check again" : "Fork & build"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
