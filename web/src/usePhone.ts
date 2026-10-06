import { useSyncExternalStore } from "react";

/** The phone breakpoint of styles.css, shared by layout and export defaults. */
export const PHONE = window.matchMedia("(max-width: 760px)");
const subscribe = (change: () => void) => {
  PHONE.addEventListener("change", change);
  return () => PHONE.removeEventListener("change", change);
};

export const usePhone = () => useSyncExternalStore(subscribe, () => PHONE.matches);
