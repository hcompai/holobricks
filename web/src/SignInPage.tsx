import { EnvelopeSimpleIcon, GoogleLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { signIn, signInError, signInOnPlatform } from "./account";
import { Brick } from "./BrickLoader";

/** The build a shared link opens, read back from the link preview tags api/preview.ts wrote; null on any other page. */
function sharedBuild(): { name: string; author: string | null; cover: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("public") && !params.has("showcase")) return null;
  const tag = (key: string) => document.querySelector(`meta[property="${key}"]`)?.getAttribute("content") ?? "";
  const name = tag("og:title").match(/^(.+) · HoloBricks$/)?.[1];
  if (!name) return null;
  return {
    name,
    author: tag("og:description").match(/, shared by (.+)$/)?.[1] ?? null,
    cover: tag("og:image:alt") === name ? tag("og:image") : null,
  };
}

/** All a signed-out visitor sees: the build a colleague shared, if any, and the ways in with an H account. */
export function SignInPage() {
  const [leaving, setLeaving] = useState(false);
  const [onPlatform, setOnPlatform] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [shared] = useState(sharedBuild);
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    const back = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);
  return (
    <main className="sign-in-page">
      {shared?.cover && !coverFailed ? (
        <img className="sign-in-cover" src={shared.cover} alt={shared.name} onError={() => setCoverFailed(true)} />
      ) : (
        <div className="sign-in-brick">
          <div className="brick-float">
            <Brick />
          </div>
          <div className="brick-shadow" />
        </div>
      )}
      {shared ? (
        <>
          <p className="sign-in-kicker">
            {shared.author ? `${shared.author} shared with you` : "From the HoloBricks gallery"}
          </p>
          <h1>{shared.name}</h1>
          <p className="sign-in-lead">Sign in to open it in HoloBricks.</p>
        </>
      ) : (
        <>
          <h1>HoloBricks</h1>
          <p className="sign-in-lead">
            Tell Holo what you'd like to build and watch it come together, one brick at a time.
          </p>
        </>
      )}
      <button
        className="primary sign-in-method"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void signIn();
        }}
      >
        <GoogleLogoIcon size={18} weight="bold" />
        {leaving ? "Opening Google…" : "Continue with Google"}
      </button>
      <button
        className="sign-in-method"
        disabled={leaving || onPlatform}
        onClick={() => {
          setOnPlatform(true);
          setBlocked(false);
          void signInOnPlatform().then((opened) => {
            setOnPlatform(false);
            setBlocked(!opened);
          });
        }}
      >
        <EnvelopeSimpleIcon size={18} weight="bold" />
        {onPlatform ? "Finish signing in in the popup…" : "Sign in with email"}
      </button>
      {(blocked || signInError) && (
        <p className="error-text sign-in-error" role="alert">
          {blocked ? "Your browser blocked the sign-in popup: allow popups for this site and try again." : signInError}
        </p>
      )}
      <p className="sign-in-fine">HoloBricks is open to everyone at H Company.</p>
    </main>
  );
}
