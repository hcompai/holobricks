import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fira-code";
import "@fontsource-variable/plus-jakarta-sans";
import { BrickLoader } from "./BrickLoader";
import "./styles.css";

const App = lazy(() => import("./App"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<BrickLoader label="Loading Brickyard…" />}>
      <App />
    </Suspense>
  </StrictMode>,
);
