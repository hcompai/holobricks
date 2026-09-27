import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fira-code";
import "@fontsource-variable/plus-jakarta-sans";
import App from "./App";
import "./styles.css";

const film = new URLSearchParams(window.location.search).get("film");
if (film) {
  void import("./filmJob").then(({ runFilmJob }) => runFilmJob(film));
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
