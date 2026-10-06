import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { type CatalogPart, packTitle, searchParts, usePartCatalog } from "./partCatalog";
import { usePartPreview } from "./partPreview";

interface Entry {
  part: string;
  title: string;
  pack: string | undefined;
  size: string | null;
}

const number = (part: string) => part.replace(/\.dat$/, "");

const size = (p: CatalogPart) => `${p.studs[0]}×${p.studs[1]} · ${p.plates} plate${p.plates === 1 ? "" : "s"}`;

function Tile({
  entry,
  color,
  current,
  onPick,
}: {
  entry: Entry;
  color: number;
  current: boolean;
  onPick: () => void;
}) {
  const src = usePartPreview(entry.part, entry.pack, color);
  return (
    <button
      role="option"
      aria-selected={current}
      className="part-tile"
      title={`${entry.title} (${number(entry.part)})${entry.size ? `, ${entry.size}` : ""}`}
      aria-label={`${entry.title} (${number(entry.part)})`}
      disabled={!entry.pack}
      onClick={onPick}
    >
      <span className="part-preview">{src && <img src={src} alt="" />}</span>
      <span className="part-tile-title">{entry.title}</span>
      <small>{number(entry.part)}</small>
    </button>
  );
}

/** Pick a part for the selected pieces, by words or number: the model's own parts first, then those Holo builds with. */
export function PartPicker({
  used,
  packs,
  current,
  color,
  onPick,
  onBack,
}: {
  /** The model's parts, most used first. */
  used: string[];
  /** The model's packed parts. */
  packs: Record<string, string>;
  /** The selected pieces' parts. */
  current: string[];
  /** Previews show the parts in the selection's color. */
  color: number;
  onPick: (part: string, pack: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const catalog = usePartCatalog(true);
  const listed = new Map(catalog?.parts.map((p) => [p.part, p]) ?? []);
  const entry = (part: string): Entry => {
    const known = listed.get(part);
    return {
      part,
      title: known?.title ?? packTitle(packs[part]) ?? number(part),
      pack: packs[part] ?? catalog?.packs[part],
      size: known ? size(known) : null,
    };
  };
  const sections = [
    { label: "In this model", entries: searchParts(used.map(entry), query) },
    {
      label: "Holo's parts",
      entries: searchParts(
        (catalog?.parts ?? []).filter((p) => !used.includes(p.part)).map((p) => entry(p.part)),
        query,
      ),
    },
  ].filter((s) => s.entries.length);

  return (
    <div className="part-picker">
      <div className="part-picker-head">
        <button className="quiet icon-button" onClick={onBack} title="Back" aria-label="Back">
          <ArrowLeftIcon size={14} weight="bold" />
        </button>
        <input
          type="search"
          autoFocus
          placeholder="Search parts: slope 2x2, 3001…"
          aria-label="Search parts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            if (query) setQuery("");
            else onBack();
          }}
        />
      </div>
      <div className="part-results" role="listbox" aria-label="Parts">
        {sections.map((s) => (
          <section key={s.label}>
            <small>{s.label}</small>
            <div className="part-tiles">
              {s.entries.map((e) => (
                <Tile
                  key={e.part}
                  entry={e}
                  color={color}
                  current={current.length === 1 && current[0] === e.part}
                  onPick={() => e.pack && onPick(e.part, e.pack)}
                />
              ))}
            </div>
          </section>
        ))}
        {catalog === undefined && <p className="muted">Loading parts…</p>}
        {catalog === null && (
          <p className="muted">Only the model's own parts: this app was built without a parts catalog.</p>
        )}
        {catalog !== undefined && !sections.length && <p className="muted">No part matches “{query}”.</p>}
      </div>
    </div>
  );
}
