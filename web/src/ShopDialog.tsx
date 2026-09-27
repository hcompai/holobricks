import { ArrowUpRightIcon, CheckIcon, CopyIcon, CubeIcon, ShoppingBagIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Build } from "./api";
import { HOLOTAB_INSTALL, prepareShopping, shoppingPrompt, shoppingUrl, type ShoppingPackage } from "./shopping";

interface Props {
  build: Build;
  preview: Promise<Blob | null>;
  onClose: () => void;
}

export function ShopDialog({ build, preview, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fallback = useRef<HTMLTextAreaElement>(null);
  const [pack, setPack] = useState<ShoppingPackage | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
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
    const controller = new AbortController();
    setError("");
    prepareShopping(build, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setPack(result);
      },
      (reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Could not prepare your parts.");
      },
    );
    return () => controller.abort();
  }, [build, attempt]);

  useEffect(() => {
    if (manual) {
      fallback.current?.focus();
      fallback.current?.select();
    }
  }, [manual]);

  const copy = async () => {
    if (!pack) return;
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
    <dialog ref={dialog} className="shop-dialog" aria-labelledby="shop-title" onCancel={onClose}>
      <div className="shop-heading">
        <span className="shop-eyebrow">
          <ShoppingBagIcon size={16} /> FROM YOUR SCREEN TO YOUR HANDS
        </span>
        <button className="icon-button" aria-label="Close shopping" onClick={onClose}>
          <XIcon size={18} />
        </button>
      </div>
      <h2 id="shop-title">Make it real.</h2>
      <p className="shop-intro">Let HoloTab find your bricks and get your carts ready. You choose when to pay.</p>
      <div className="shop-model">
        <div className="shop-image">
          {image ? <img src={image} alt={build.name} /> : <CubeIcon size={40} weight="duotone" />}
        </div>
        <div>
          <strong>{build.name}</strong>
          <p>
            {build.pieces.length.toLocaleString()} pieces{pack ? ` · ${pack.lots.toLocaleString()} combinations` : ""}
          </p>
          <span>Saved parts list</span>
        </div>
      </div>
      <ol className="shop-steps">
        <li>
          <span className="shop-number">1</span>
          <div>
            <b>Get HoloTab for Chrome</b>
            <p>Already installed? You’re ready for the next step.</p>
            <a href={HOLOTAB_INSTALL} target="_blank" rel="noopener noreferrer">
              Install HoloTab <ArrowUpRightIcon size={14} />
            </a>
          </div>
        </li>
        <li>
          <span className={`shop-number ${copied ? "complete" : ""}`}>
            {copied ? <CheckIcon size={16} weight="bold" /> : "2"}
          </span>
          <div>
            <b>Copy your shopping request</b>
            <p>Your exact parts list and instructions are included.</p>
          </div>
        </li>
        <li>
          <span className={`shop-number ${copied ? "current" : ""}`}>3</span>
          <div>
            <b>Paste into HoloTab and send</b>
            <p>Open HoloTab in Chrome. It imports your list on BrickLink and helps you get to checkout.</p>
          </div>
        </li>
      </ol>
      {error ? (
        <div className="shop-error" role="alert">
          <p style={{ whiteSpace: "pre-line" }}>{error}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : (
        <button className="shop-copy" disabled={!pack || copying} onClick={copy}>
          {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
          {!pack ? "Verifying your parts and colors…" : copied ? "Copy again" : "Copy for HoloTab"}
        </button>
      )}
      <p className="shop-feedback" role="status">
        {copied ? "Copied! Open HoloTab in Chrome, paste, and send." : ""}
      </p>
      {manual && pack && (
        <div className="shop-manual">
          <label htmlFor="shop-request">Select and copy this request, then paste it into HoloTab.</label>
          <textarea id="shop-request" ref={fallback} readOnly rows={7} value={shoppingPrompt(pack)} />
        </div>
      )}
      <div className="shop-footer">
        {pack && (
          <a href={shoppingUrl(pack)} target="_blank" rel="noopener noreferrer">
            View or download parts <ArrowUpRightIcon size={13} />
          </a>
        )}
        <p>Prices and availability are checked on BrickLink. Printed instructions aren’t included yet.</p>
      </div>
    </dialog>
  );
}
