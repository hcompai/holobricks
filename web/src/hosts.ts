/** The H platform HoloBricks signs in with and builds on: VITE_PLATFORM=staging at build time picks staging. */
const HOSTS = {
  production: {
    site: "https://bricks.hcompany.ai",
    portal: "https://portal.api.eu.hcompany.ai/api",
    /** The Platform frontend, whose login page takes every sign-in method, in a popup that posts the token back. */
    platform: "https://platform.hcompany.ai",
    agents: "https://agp.eu.hcompany.ai",
    /** The portal's access token, set on .hcompany.ai once its Google sign-in succeeds. */
    token: "access_token",
  },
  staging: {
    site: "https://bricks.staging.sandboxh.ai",
    portal: "https://portal.api.eu.staging.sandboxh.ai/api",
    platform: "https://platform.staging.sandboxh.ai",
    agents: "https://agp.staging.sandboxh.ai",
    token: "staging_access_token",
  },
};

export const platformOf = (name: unknown) => HOSTS[name === "staging" ? "staging" : "production"];

export const H = platformOf(import.meta.env?.VITE_PLATFORM);
