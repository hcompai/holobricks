import { expect, test } from "@playwright/test";
import { applyEdits } from "../src/edits";
import { forkSeed } from "../src/forkModel";
import { fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

for (const continued of [false, true]) {
  test(`saved edits on a ${continued ? "continued" : "new"} fork settle and remain editable after reload`, async ({
    page,
  }) => {
    const model = fixture();
    const id = "fork-edited";
    const edit = { kind: "move" as const, ids: [0], by: [20, 0, 0] as [number, number, number] };
    const edited = revised({ ...model, pieces: applyEdits(model.pieces, [edit]) });
    const { copies } = await site(page);
    const agp = await platform(page);
    copies.set(id, {
      id,
      name: model.name,
      pieces: model.pieces.length,
      created: 1,
      sessionId: continued ? "continued" : null,
      seed: forkSeed(
        model,
        { id: "original", source: "session", name: model.name, version: null, revision: model.revision },
        model.name,
      ),
    });
    if (continued) {
      agp.session("continued", "completed");
      agp.share("continued", model);
    }
    await page.addInitScript(
      ({ id, revision, edit }) => {
        if (!localStorage.getItem("brickyard.edits"))
          localStorage.setItem("brickyard.edits", JSON.stringify({ [id]: { revision, edits: [edit] } }));
        const counters = window as Window & { revisionHashes: number };
        counters.revisionHashes = 0;
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = (...args) => {
          // Bound the regression's broken loop before it can hang the test browser.
          if (++counters.revisionHashes > 100) return Promise.reject(new Error("Unchanged edit loop"));
          return digest(...args);
        };
      },
      { id, revision: model.revision, edit },
    );
    const hashes = () => page.evaluate(() => (window as Window & { revisionHashes: number }).revisionHashes);
    const viewer = page.locator(".viewer");
    await page.goto(`/?fork=${id}`);
    await expect(viewer).toHaveAttribute("data-revision", edited.revision);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(viewer).toHaveAttribute("data-revision", model.revision);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(viewer).toHaveAttribute("data-revision", edited.revision);
    await page.reload();
    await expect(viewer).toHaveAttribute("data-revision", edited.revision);
    await page.getByRole("button", { name: "Front", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");
    // Let passive effects run after user interactions: unchanged models must stop being rebuilt.
    await page.waitForTimeout(500);
    expect(await hashes()).toBeLessThan(20);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(viewer).toHaveAttribute("data-revision", model.revision);
    await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeEnabled();
    expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
  });
}
