import { SignInIcon, SignOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { signIn, signOut, useAccount } from "./account";
import { useMenu } from "./useMenu";

/** Opens the H portal's sign-in window; shows why it failed, if it does. */
export function SignInButton() {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setSigning(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSigning(false);
    }
  };
  return (
    <span className="sign-in">
      {error && (
        <span className="sign-in-error" role="alert">
          {error}
        </span>
      )}
      <button className="sign-in-button" disabled={signing} onClick={start}>
        <SignInIcon size={16} /> {signing ? "Signing in…" : "Sign in"}
      </button>
    </span>
  );
}

/** The signed-in user, with a menu to sign out; a sign-in button otherwise. */
export function AccountMenu() {
  const account = useAccount();
  const { open, setOpen, root } = useMenu();
  if (!account) return <SignInButton />;
  const { name, email } = account.user;
  return (
    <div className="menu" ref={root}>
      <button
        className={open ? "icon-button avatar active" : "icon-button avatar"}
        onClick={() => setOpen(!open)}
        title={email}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {name.slice(0, 1)}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <div className="menu-head">
            <b>{name}</b>
            <span className="muted small">{email}</span>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            <SignOutIcon size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
