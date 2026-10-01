import { useEffect, useRef, useState } from "react";
import { projectNames, renameProject, type ProjectName } from "./library";
import type { BuildRef } from "./useBuild";

type Names = Record<string, ProjectName>;

/** Keep an acknowledged rename while the Blob CDN catches up; the server remains the durable source. */
export function useProjectNames(owner: string) {
  const storage = `brickyard.names.${owner}`;
  const [names, setNames] = useState<Names>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storage) ?? "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  });
  const latest = useRef(names);
  const merge = (entries: ProjectName[]) => {
    const next = { ...latest.current };
    for (const entry of entries) if (!next[entry.id] || entry.updated >= next[entry.id].updated) next[entry.id] = entry;
    latest.current = next;
    setNames(next);
    try {
      localStorage.setItem(storage, JSON.stringify(next));
    } catch {
      /* The server has the name. */
    }
  };
  useEffect(() => {
    let active = true;
    void projectNames().then(
      (entries) => {
        if (active) merge(entries);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [owner]);
  return {
    names,
    rename: async (ref: BuildRef, name: string) => merge([await renameProject(ref, name)]),
  };
}
