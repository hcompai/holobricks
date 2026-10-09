import { posthog } from "posthog-js";
import { scrubbed } from "./privateText";

/** Same project, consent and attribution as hcompany.ai, so a visitor who signs up on the Platform joins their visits here. */
const POSTHOG_KEY = "phc_pRHgY8yZ8ivPJekkRXYeKvhCxxGgFBjmomNLZGFumJBK";
const SITE = "holobricks";
/** Only the live site measures: local runs, tests and Vercel previews send nothing. */
const ENABLED = location.hostname.endsWith("hcompany.ai");

/** Axeptio vendor keys, as they appear in `cookies:complete` choices and in `axeptio_authorized_vendors`. */
const VENDOR_POSTHOG = "posthog";
const VENDOR_ATTRIBUTION = "h_attr";

/** The signup tags platform.hcompany.ai reads from this cookie on `.hcompany.ai`. */
const ATTRIBUTION_COOKIE = "h_attr";
const ATTRIBUTION_DAYS = 30;
const SIGNUP_TAGS = { product: SITE, source: SITE };

type AxeptioChoices = Record<string, boolean | undefined>;
interface AxeptioSdk {
  on(event: "cookies:complete", cb: (choices: AxeptioChoices) => void): void;
}
declare global {
  interface Window {
    openAxeptioCookies?: () => void;
    _axcb?: Array<(sdk: AxeptioSdk) => void>;
    dataLayer?: object[];
  }
}

export type Event =
  | ["sign_in_completed"]
  | ["build_started", { from: "prompt" | "remix"; image_count: number }]
  | ["build_forked"]
  | ["build_imported"]
  | ["build_published"]
  | ["build_liked", { liked: boolean }]
  | ["link_opened", { to: string }]
  | ["holotab_request_copied"];

/** Queue a callback on the Axeptio SDK, which GTM loads later: it runs at once if the SDK has already booted. */
function onAxeptio(cb: (sdk: AxeptioSdk) => void) {
  window._axcb = window._axcb ?? [];
  window._axcb.push(cb);
}

const domainAttribute = () => (ENABLED ? "; Domain=.hcompany.ai" : "");

function writeCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; Expires=${expires.toUTCString()}${domainAttribute()}; Path=/; SameSite=Lax; Secure`;
}

const deleteCookie = (name: string) =>
  (document.cookie = `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT${domainAttribute()}; Path=/; SameSite=Lax; Secure`);

if (ENABLED) {
  posthog.init(POSTHOG_KEY, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    person_profiles: "identified_only",
    cookieless_mode: "on_reject",
    persistence: "localStorage+cookie",
    capture_pageview: "history_change",
    disable_session_recording: true,
    before_send: (event) => (event?.event === "$autocapture" ? scrubbed(event) : event),
  });
  posthog.register({ site: SITE });
}

let posthogAllowed = false;
let attributionAllowed = false;

onAxeptio((sdk) =>
  sdk.on("cookies:complete", (choices) => {
    posthogAllowed = choices[VENDOR_POSTHOG] === true;
    if (posthogAllowed) posthog.opt_in_capturing();
    else posthog.opt_out_capturing();

    attributionAllowed = choices[VENDOR_ATTRIBUTION] === true;
    if (!attributionAllowed) deleteCookie(ATTRIBUTION_COOKIE);
  }),
);

export function track(...[name, properties]: Event) {
  if (!ENABLED) return;
  const event = `${SITE}.${name}`;
  posthog.capture(event, properties);
  window.dataLayer?.push({ event, ...properties });
}

/** Tag the signup the Platform may be about to see, before the page leaves for it. */
export function rememberSignup() {
  if (attributionAllowed) writeCookie(ATTRIBUTION_COOKIE, JSON.stringify(SIGNUP_TAGS), ATTRIBUTION_DAYS);
}

/**
 * The tags the portal puts on `user.signed_up` when a Google sign-in started here creates the account: what the
 * Platform reads from the `h_attr` and PostHog cookies for its own sign-ups, so both paths attribute and merge alike.
 */
export function signupTags(): Record<string, string> | null {
  const tags: Record<string, string> = {};
  if (attributionAllowed) Object.assign(tags, SIGNUP_TAGS);
  if (ENABLED && posthogAllowed) tags.ph_did = posthog.get_distinct_id();
  return Object.keys(tags).length > 0 ? tags : null;
}

/** Where an outbound link leads, named for the dashboards; other sites by their hostname. */
function destination(url: URL): string {
  if (url.hostname === "chromewebstore.google.com" && url.pathname.includes("/holotab/")) return "holotab";
  if (url.hostname === "github.com") return "github";
  if (url.hostname.endsWith("lego.com")) return "pick_a_brick";
  if (url.hostname.endsWith("bricklink.com")) return "bricklink";
  return url.hostname;
}

document.addEventListener(
  "click",
  (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    const url = new URL(link.href, location.href);
    if (url.protocol.startsWith("http") && url.hostname !== location.hostname) {
      track("link_opened", { to: destination(url) });
    }
  },
  { capture: true },
);

/** Reopen the consent banner; it waits for the SDK if GTM has not loaded it yet. */
export const openCookiePreferences = () => onAxeptio(() => window.openAxeptioCookies?.());
