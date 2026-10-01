import { SignOutIcon } from "@phosphor-icons/react";
import { type Account, signOut } from "./account";
import { ThemeToggle } from "./ThemeToggle";
import { useMenu } from "./useMenu";

/** The signed-in user, with a menu for the theme and to sign out. */
export function AccountMenu({ account, building = false }: { account: Account; building?: boolean }) {
  const { open, setOpen, root } = useMenu();
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
    </div>
  );
}
