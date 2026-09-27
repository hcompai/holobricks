import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Shared runners render WebGL on the CPU; shader warm-up alone can take ~30 seconds.
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5188",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5188 --strictPort",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: !process.env.CI,
  },
});
