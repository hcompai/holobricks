import { CheckIcon, LinkIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

const COPIED_MS = 2000;

/** An icon button copying the build's link, then showing for a moment that it did. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => navigator.clipboard.writeText(url).then(() => setCopied(true), console.error);
  const label = copied ? "Link copied" : "Copy link";
  return (
    <button className="icon-button" onClick={copy} title={label} aria-label={label}>
      {copied ? <CheckIcon size={16} weight="bold" /> : <LinkIcon size={16} weight="bold" />}
    </button>
  );
}
