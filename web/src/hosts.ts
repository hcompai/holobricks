/** The H platform HoloBricks signs in with and builds on: VITE_PLATFORM=staging at build time picks staging. */
const HOSTS = {
  production: {
    site: "https://bricks.hcompany.ai",
    portal: "https://portal.api.eu.hcompany.ai/api",
    agents: "https://agp.eu.hcompany.ai",
    /** The portal's access token, set on .hcompany.ai once its Google sign-in succeeds. */
    token: "access_token",
  },
  staging: {
    site: "https://bricks.staging.sandboxh.ai",
    portal: "https://portal.api.eu.staging.sandboxh.ai/api",
    agents: "https://agp.staging.sandboxh.ai",
    token: "staging_access_token",
  },
};

export const platformOf = (name: unknown) => HOSTS[name === "staging" ? "staging" : "production"];

export const H = platformOf(import.meta.env?.VITE_PLATFORM);
