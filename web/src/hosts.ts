/** The H platform Brickyard signs in with and builds on: VITE_PLATFORM=staging at build time picks staging. */
const HOSTS = {
  production: {
    login: "https://portal.hcompany.ai",
    portal: "https://portal.api.eu.hcompany.ai/api",
    agents: "https://agp.eu.hcompany.ai",
  },
  staging: {
    login: "https://platform.staging.sandboxh.ai",
    portal: "https://portal.api.eu.staging.sandboxh.ai/api",
    agents: "https://agp.staging.sandboxh.ai",
  },
};

export const H = HOSTS[import.meta.env.VITE_PLATFORM === "staging" ? "staging" : "production"];
