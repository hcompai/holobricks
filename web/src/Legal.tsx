import { DiscordLogoIcon, GithubLogoIcon, LinkedinLogoIcon, XIcon, XLogoIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export const TERMS = "https://www.hcompany.ai/terms-of-use";
export const PRIVACY = "https://www.hcompany.ai/privacy-policy";

const out = (href: string, text: ReactNode) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </a>
);

/** Third-party assets, with the attribution their licenses ask for. */
export const REPO = "https://github.com/hcompai/holobricks";

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
  { what: "Source", credit: <>HoloBricks is open source: {out(REPO, "hcompai/holobricks")} on GitHub.</> },
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

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Demos",
    links: [
      ["HoloBricks", "https://bricks.hcompany.ai"],
      ["HoloBlocks", "https://blocks.hcompany.ai"],
      ["All demos", "https://build.hcompany.ai"],
      ["Source on GitHub", REPO],
    ],
  },
  {
    title: "Agents API",
    links: [
      ["Overview", "https://hcompany.ai/agents-api"],
      ["Docs", "https://hub.hcompany.ai/"],
      ["H Platform", "https://platform.hcompany.ai"],
      ["Pricing", "https://hcompany.ai/pricing"],
    ],
  },
  {
    title: "H Company",
    links: [
      ["Website", "https://hcompany.ai"],
      ["Holo4", "https://hcompany.ai/newsroom/holo4"],
      ["Research", "https://hcompany.ai/research"],
      ["Careers", "https://hcompany.ai/careers"],
      ["Contact us", "https://hcompany.ai/contact"],
    ],
  },
];

const SOCIAL = [
  { name: "X", href: "https://x.com/hcompany_ai", Icon: XLogoIcon },
  { name: "LinkedIn", href: "https://www.linkedin.com/company/h-company-ai", Icon: LinkedinLogoIcon },
  { name: "Discord", href: "https://discord.gg/gAWcDZgx4s", Icon: DiscordLogoIcon },
  { name: "GitHub", href: REPO, Icon: GithubLogoIcon },
];

const HLogo = () => (
  <svg viewBox="0 0 1035 600" fill="currentColor" aria-hidden="true">
    <circle cx="300" cy="300" r="300" />
    <rect x="838" y="195" width="54" height="220" />
    <rect x="838" y="282" width="197" height="45" />
    <rect x="981" y="195" width="54" height="220" />
  </svg>
);

/** The home page's footer: H Company, the demos, the Agents API, the legal pages and the credits. */
export function SiteFooter() {
  const [credits, setCredits] = useState(false);
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-top">
          <div className="site-footer-brand">
            {out("https://hcompany.ai", <HLogo />)}
            <p>Built by H Company on the Agents API. Make your own app on top of Holo.</p>
            <div className="site-footer-social">
              {SOCIAL.map(({ name, href, Icon }) => (
                <a key={name} href={href} target="_blank" rel="noopener noreferrer" aria-label={name}>
                  <Icon size={16} weight="fill" />
                </a>
              ))}
            </div>
          </div>
          <nav aria-label="Footer">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h3>{column.title}</h3>
                <ul>
                  {column.links.map(([text, href]) => (
                    <li key={text}>{out(href, text)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="site-footer-bottom">
          <p>© 2026 H Company. Founded in Paris, built around the world.</p>
          <ul>
            <li>{out(PRIVACY, "Privacy Policy")}</li>
            <li>{out(TERMS, "Terms of Service")}</li>
            <li>{out("https://trust.hcompany.ai/", "Trust Center")}</li>
            <li>
              <button onClick={() => setCredits(true)}>Credits</button>
            </li>
          </ul>
        </div>
      </div>
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
