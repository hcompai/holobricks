import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fira-code";
import "@fontsource-variable/plus-jakarta-sans";
import "./analytics";
import { useAccount } from "./account";
import { BrickLoader } from "./BrickLoader";
import "./styles.css";

const App = lazy(() => import("./App"));

function Root() {
  const account = useAccount();
  return (
    <Suspense fallback={<BrickLoader label="Loading HoloBricks…" />}>
      <App key={account?.user.id ?? "signed-out"} account={account} />
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
