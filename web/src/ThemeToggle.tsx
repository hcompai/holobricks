import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const KEY = "brickyard-theme";
const THEMES = [
  { id: "system", label: "System theme", Icon: MonitorIcon },
  { id: "light", label: "Light theme", Icon: SunIcon },
  { id: "dark", label: "Dark theme", Icon: MoonIcon },
] as const;

function stored(): Theme {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : "system";
}

/** Light, dark, or the OS setting; index.html applies the stored choice before the first paint. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      delete root.dataset.theme;
      localStorage.removeItem(KEY);
    } else {
      root.dataset.theme = theme;
      localStorage.setItem(KEY, theme);
    }
  }, [theme]);

  return (
    <div className="tabs theme-toggle">
      {THEMES.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={theme === id ? "active" : ""}
          onClick={() => setTheme(id)}
          title={label}
          aria-label={label}
        >
          <Icon size={14} weight="bold" />
        </button>
      ))}
    </div>
  );
}
