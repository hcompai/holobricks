import { MoonIcon, SunIcon } from "@phosphor-icons/react";
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

/** Follows the OS until clicked, then keeps the chosen theme; index.html applies it before the first paint. */
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

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button className="icon-button" onClick={toggle} title={label} aria-label={label}>
      {theme === "dark" ? <SunIcon size={16} weight="bold" /> : <MoonIcon size={16} weight="bold" />}
    </button>
  );
}
