import { IdentificationCardIcon, SignOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { type Account, renamed, signOut } from "./account";
import { NameDialog } from "./NameDialog";
import { ThemeToggle } from "./ThemeToggle";
import { useMenu } from "./useMenu";

/** The signed-in user, with a menu for their display name, the theme and to sign out. */
export function AccountMenu({
  account,
  building = false,
  onRenamed,
}: {
  account: Account;
  building?: boolean;
  onRenamed?: (name: string) => void;
}) {
  const { open, setOpen, root } = useMenu();
  const [naming, setNaming] = useState(false);
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
        {(name || email).slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <div className="menu-head">
            {name && <b>{name}</b>}
            <span className="muted small">{email}</span>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setNaming(true);
            }}
          >
            <IdentificationCardIcon size={16} /> Display name
            <span className="menu-value muted">{name || "None"}</span>
          </button>
          <ThemeToggle />
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              if (
                building &&
                !window.confirm(
                  "Holo still needs this tab to render your build. Signing out can interrupt it. Sign out anyway?",
                )
              )
                return;
              setOpen(false);
              signOut();
            }}
          >
            <SignOutIcon size={16} /> Sign out
          </button>
        </div>
      )}
      {naming && (
        <NameDialog
          name={name}
          onSaved={(next) => {
            renamed(next);
            onRenamed?.(next);
          }}
          onClose={() => setNaming(false)}
        />
      )}
    </div>
  );
}
