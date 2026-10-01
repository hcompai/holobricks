import { CheckIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

export function ProjectTitle({
  name,
  className,
  onRename,
}: {
  name: string;
  className: string;
  onRename?: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!onRename)
    return (
      <span className={className} title={name}>
        {name}
      </span>
    );
  if (!editing)
    return (
      <span className={`${className} project-title`}>
        <button
          className="quiet"
          aria-label="Rename"
          title="Rename"
          onClick={() => {
            setValue(name);
            setError("");
            setEditing(true);
          }}
        >
          <span>{name}</span>
          <PencilSimpleIcon size={13} />
        </button>
      </span>
    );
  const save = async () => {
    if (busy) return;
    const next = value.trim();
    if (!next) {
      setError("Enter a name.");
      return;
    }
    if (next === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onRename(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't rename. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={`${className} project-title editing`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        aria-label="Project name"
        value={value}
        maxLength={80}
        disabled={busy}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            event.stopPropagation();
            setEditing(false);
          }
        }}
      />
      <button className="quiet" type="submit" aria-label="Save" title="Save" disabled={busy}>
        <CheckIcon size={16} />
      </button>
      <button
        className="quiet"
        type="button"
        aria-label="Cancel"
        title="Cancel"
        disabled={busy}
        onClick={() => setEditing(false)}
      >
        <XIcon size={16} />
      </button>
      {error && (
        <span className="rename-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
