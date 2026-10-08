import { XIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export const TERMS = "https://www.hcompany.ai/terms-of-use";
export const PRIVACY = "https://www.hcompany.ai/privacy-policy";

const out = (href: string, text: ReactNode) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </a>
);

/** Third-party assets, with the attribution their licenses ask for. */
const CREDITS: { what: string; credit: ReactNode }[] = [
  {
    what: "Part geometry",
    credit: (
      <>
        {out("https://library.ldraw.org/", "LDraw parts library")} by the LDraw.org contributors, named in each part
        file, under {out("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0")} and{" "}
        {out("https://creativecommons.org/licenses/by/2.0/", "CC BY 2.0")}. Packed into one file per part for the
        viewer.
      </>
    ),
  },
  {
    what: "Parts and colors",
    credit: <>Catalog data from {out("https://rebrickable.com/", "Rebrickable")}.</>,
  },
  {
    what: "Part and color numbers",
    credit: <>Shopping lists use {out("https://www.bricklink.com/", "BrickLink")} numbers.</>,
  },
  {
    what: "Fonts",
    credit: (
      <>
        {out("https://github.com/tokotype/PlusJakartaSans", "Plus Jakarta Sans")}, © 2020 The Plus Jakarta Sans Project
        Authors, and {out("https://github.com/tonsky/FiraCode", "Fira Code")}, © 2014-2020 The Fira Code Project
        Authors, under the {out("https://openfontlicense.org/", "SIL Open Font License 1.1")}.
      </>
    ),
  },
];

function CreditsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="dialog credits-dialog" aria-labelledby="credits-title" onCancel={onClose}>
      <div className="dialog-head">
        <h2 id="credits-title">Credits</h2>
        <button className="quiet icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <dl className="credits">
        {CREDITS.map((c) => (
          <div key={c.what}>
            <dt>{c.what}</dt>
            <dd>{c.credit}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}

/** The home page's quiet footer: the terms, the privacy policy and the credits. */
export function LegalFooter() {
  const [credits, setCredits] = useState(false);
  return (
    <footer className="legal">
      {out(TERMS, "Terms")}
      <span aria-hidden>·</span>
      {out(PRIVACY, "Privacy")}
      <span aria-hidden>·</span>
      <button onClick={() => setCredits(true)}>Credits</button>
      {credits && <CreditsDialog onClose={() => setCredits(false)} />}
    </footer>
  );
}

/** What signing in agrees to, under the sign-in buttons. */
export const SignInTerms = () => (
  <p className="legal-note">
    By signing in you agree to the {out(TERMS, "Terms")} and {out(PRIVACY, "Privacy Policy")}.
  </p>
);
