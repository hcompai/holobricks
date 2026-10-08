import { EnvelopeSimpleIcon, GoogleLogoIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { signIn, signInError, signInOnPlatform } from "./account";

/** The ways in with an H account, asked for when a signed-out visitor wants to build. */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const google = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [onPlatform, setOnPlatform] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    google.current?.focus();
    const back = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);
  return (
    <dialog ref={dialog} className="dialog sign-in-dialog" aria-labelledby="sign-in-title" onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <h2 id="sign-in-title">Sign in to build</h2>
          <p>Holo builds with your own key. Sign in to get one.</p>
        </div>
        <button className="quiet icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      <div className="dialog-generation">
        <button
          ref={google}
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
          <p className="error-text" role="alert">
            {blocked
              ? "Your browser blocked the sign-in popup: allow popups for this site and try again."
              : signInError}
          </p>
        )}
      </div>
    </dialog>
  );
}
