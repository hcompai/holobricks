import {
  ArrowUpRightIcon,
  CheckIcon,
  CubeIcon,
  DownloadSimpleIcon,
  ShoppingCartIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PdfButton } from "./InstructionsExport";
import type { Build, Piece, ShoppingPackage } from "./model";
import { estimate, money, type PriceTable, storeUrl, UPLOAD_LIMIT, uploadLists } from "./pickabrick";
import { HOLOTAB_INSTALL, prepareShopping, shoppingPrompt } from "./shopping";

interface Props {
  build: Build;
  preview: Promise<Blob | null>;
  /** Pick a Brick's prices, or null without them. */
  table: PriceTable | null;
  /** Whether the pieces include this browser's hand edits, which BrickLink cannot be sent. */
  edited: boolean;
  describe: (piece: Piece) => string;
  onReset: () => void;
  onClose: () => void;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Every way to build the model for real: a BrickLink cart through HoloTab, a Pick a Brick list, and the instructions. */
export function ShopDialog({ build, preview, table, edited, describe, onReset, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fallback = useRef<HTMLTextAreaElement>(null);
  const [pack, setPack] = useState<ShoppingPackage | null>(null);
  const [error, setError] = useState("");
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    let url = "";
    preview
      .then((blob) => {
        if (active && blob) {
          url = URL.createObjectURL(blob);
          setImage(url);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  useEffect(() => {
    setCopied(false);
    setManual(false);
    try {
      setPack(prepareShopping(build));
      setError("");
    } catch (reason) {
      setPack(null);
      setError(reason instanceof Error ? reason.message : "Could not prepare your parts.");
    }
  }, [build]);

  useEffect(() => {
    if (manual) {
      fallback.current?.focus();
      fallback.current?.select();
    }
  }, [manual]);

  const copy = async () => {
    if (!pack) return;
    if (pack.validation.valid_until * 1000 <= Date.now()) {
      setError("This parts list needs a fresh catalog check. Please try again.");
      setPack(null);
      setCopied(false);
      setManual(false);
      return;
    }
    setCopying(true);
    try {
      await navigator.clipboard.writeText(shoppingPrompt(pack));
      setCopied(true);
      setManual(false);
    } catch {
      setManual(true);
    } finally {
      setCopying(false);
    }
  };

  return (
    <dialog ref={dialog} className="dialog shop-dialog" aria-labelledby="shop-title" onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <h2 id="shop-title">Build it for real</h2>
          <p>Get the bricks, then follow the instructions.</p>
        </div>
        <button className="quiet icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <div className="shop-model">
        <div className="shop-image">
          {image ? <img src={image} alt={build.name} /> : <CubeIcon size={40} weight="duotone" />}
        </div>
        <div>
          <strong>{build.name}</strong>
          <p>
            {plural(build.pieces.length, "piece", "pieces")}
            {pack && ` · ${plural(pack.lots, "kind of brick", "kinds of bricks")}`}
          </p>
        </div>
      </div>

      <section className="shop-option" aria-label="BrickLink">
        {error ? (
          <div className="shop-error" role="alert">
            <p className="error-text">{error}</p>
            {edited && <button onClick={onReset}>Reset my edits</button>}
          </div>
        ) : (
          <button className="primary shop-copy" disabled={!pack || copying} onClick={copy}>
            {copied ? <CheckIcon size={16} /> : <ShoppingCartIcon size={16} />}
            {!pack ? "Verifying your parts and colors…" : copied ? "Copy again" : "Fill my BrickLink cart"}
          </button>
        )}
        <p className={copied ? "shop-feedback done" : "shop-feedback"} role="status">
          {copied
            ? "Copied. Paste it into HoloTab in Chrome and send."
            : "Copies a request for HoloTab, our Chrome extension: it fills your BrickLink carts, and you choose when to pay."}
        </p>
        {manual && pack && (
          <div className="shop-manual">
            <label htmlFor="shop-request">Select and copy this request, then paste it into HoloTab.</label>
            <textarea id="shop-request" ref={fallback} readOnly rows={7} value={shoppingPrompt(pack)} />
          </div>
        )}
        <p className="shop-links">
          <a href={HOLOTAB_INSTALL} target="_blank" rel="noopener noreferrer">
            Get HoloTab <ArrowUpRightIcon size={13} />
          </a>
          {pack && (
            <a
              href={`data:application/xml;charset=utf-8,${encodeURIComponent(pack.xml)}`}
              download={`brickyard-${pack.id.slice(0, 12)}-parts.xml`}
            >
              Download parts XML <ArrowUpRightIcon size={13} />
            </a>
          )}
        </p>
      </section>

      {table && <PickABrick build={build} table={table} edited={edited} />}

      <section className="shop-option" aria-label="Instructions">
        <PdfButton build={build} describe={describe} className="shop-wide" />
      </section>
    </dialog>
  );
}

/** The pieces as lists to upload to LEGO Pick a Brick, with what they would cost there. */
function PickABrick({ build, table, edited }: { build: Build; table: PriceTable; edited: boolean }) {
  const found = useMemo(() => estimate(build.pieces, table), [build.pieces, table]);
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
    <section className="shop-option" aria-label="Pick a Brick">
      <button className="shop-wide" onClick={download}>
        <DownloadSimpleIcon size={16} />
        {files.length > 1 ? `Download ${files.length} Pick a Brick lists` : "Download Pick a Brick list"}
      </button>
      <p className="shop-note">
        <b>≈ {money(found.cents, table)}</b> on LEGO Pick a Brick for {count(found.priced)} of{" "}
        {count(build.pieces.length)} pieces
        {found.missing > 0 && `; ${count(found.missing)} are not sold there in their color`}.
        {found.outOfStock > 0 && ` ${count(found.outOfStock)} are out of stock.`}
        {edited && " Includes your edits."}
        {files.length > 1 && ` Each list holds up to ${UPLOAD_LIMIT} kinds of bricks: upload them one by one.`} Prices
        from {date}, shipping not included.{" "}
        <a href={storeUrl(table)} target="_blank" rel="noreferrer">
          Open Pick a Brick <ArrowUpRightIcon size={13} />
        </a>
      </p>
    </section>
  );
}
