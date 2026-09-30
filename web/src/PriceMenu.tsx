import { ArrowSquareOutIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Build } from "./model";
import { estimate, money, type PriceTable, storeUrl, UPLOAD_LIMIT, uploadLists } from "./pickabrick";

interface Props {
  build: Build;
  table: PriceTable;
  /** Whether the pieces shown include this browser's edits. */
  edited: boolean;
}

/** A quiet estimate beside the piece count; it opens the details and the lists to upload to Pick a Brick. */
export function PriceMenu({ build, table, edited }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const found = estimate(build.pieces, table);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!found.priced) return null;
  const files = uploadLists(found.lines);
  const date = new Date(table.fetched_at * 1000).toLocaleDateString(table.locale, { dateStyle: "medium" });
  const count = (n: number) => n.toLocaleString(table.locale);

  const download = () => {
    files.forEach((csv, i) => {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const part = files.length > 1 ? ` ${i + 1} of ${files.length}` : "";
      Object.assign(document.createElement("a"), {
        href: url,
        download: `${build.name} Pick a Brick${part}.csv`,
      }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  return (
    <div className="menu price" ref={root}>
      <button
        className="price-trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Estimated price on LEGO Pick a Brick"
      >
        ≈ {money(found.cents, table, true)}
      </button>
      {open && (
        <div className="menu-list price-details" role="dialog" aria-label="Price estimate">
          <div className="price-total">
            <b>≈ {money(found.cents, table)}</b>
            <span className="muted">on LEGO Pick a Brick</span>
          </div>
          <ul>
            <li>
              Priced {count(found.priced)} of {count(build.pieces.length)} pieces
              {found.missing > 0 && `; ${count(found.missing)} are not sold there in their color`}.
            </li>
            {found.outOfStock > 0 && <li>{count(found.outOfStock)} of them are out of stock right now.</li>}
            {edited && <li>Includes your edits in this browser.</li>}
            <li>
              Prices from {date}, {table.locale} store. Shipping not included; orders take up to 200 Bestseller and 200
              Standard pieces.
            </li>
          </ul>
          <button onClick={download}>
            <DownloadSimpleIcon size={16} />
            {files.length > 1 ? `Download ${files.length} lists for Pick a Brick` : "Download list for Pick a Brick"}
          </button>
          <a href={storeUrl(table)} target="_blank" rel="noreferrer">
            <ArrowSquareOutIcon size={16} />
            Open Pick a Brick and upload the list
          </a>
          {files.length > 1 && (
            <p className="muted">
              Pick a Brick takes {UPLOAD_LIMIT} different pieces per list: upload them one by one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
