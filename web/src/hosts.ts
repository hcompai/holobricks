/** The H platform Brickyard signs in with and builds on: VITE_PLATFORM=staging at build time picks staging. */
const HOSTS = {
  production: {
    portal: "https://portal.api.eu.hcompany.ai/api",
    agents: "https://agp.eu.hcompany.ai",
    /** The portal's access token, set on .hcompany.ai once its Google sign-in succeeds. */
    token: "access_token",
  },
  staging: {
    portal: "https://portal.api.eu.staging.sandboxh.ai/api",
    agents: "https://agp.staging.sandboxh.ai",
    token: "staging_access_token",
  },
};

export const H = HOSTS[import.meta.env?.VITE_PLATFORM === "staging" ? "staging" : "production"];
