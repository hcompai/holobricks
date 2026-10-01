import { CheckIcon, MoonIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const KEY = "brickyard-theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function stored(): Theme | null {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : null;
}

function system(): Theme {
  return systemDark.matches ? "dark" : "light";
}

/** A menu item turning the dark theme on or off: it follows the OS until clicked, then keeps the choice; index.html applies it before the first paint. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? system());

  useEffect(() => {
    const follow = () => {
      if (!stored()) setTheme(system());
    };
    systemDark.addEventListener("change", follow);
    return () => systemDark.removeEventListener("change", follow);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, next);
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  return (
    <button role="menuitemcheckbox" aria-checked={theme === "dark"} onClick={toggle}>
      <MoonIcon size={16} />
      Dark theme
      {theme === "dark" && <CheckIcon size={16} className="menu-check" />}
    </button>
  );
}
