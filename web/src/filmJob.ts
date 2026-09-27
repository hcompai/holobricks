import { api } from "./api";
import { FilmRenderer } from "./film";

/** Share of the budget for rendering, leaving room for loading and uneven frames. */
const BUDGET_SHARE = 0.9;
/** Frames rendered between checks that the film will finish within budget. */
const WINDOW = 30;

/** Run a server film job headless: render every frame in order and stream it to the server, which encodes it. */
export async function runFilmJob(job: string) {
  const status = document.createElement("pre");
  document.body.append(status);
  const log = (line: string) => (status.textContent = line);
  let film: FilmRenderer | null = null;
  try {
    const [spec, build] = await Promise.all([api.film(job), api.filmBuild(job)]);
    film = new FilmRenderer(build, document.createElement("canvas"), new AbortController().signal);
    await film.prepare();
    const { samples, label, ...options } = spec.options;
    film.configure({ ...options, label: label ?? undefined, samples: samples ?? 1 });
    const deadline = spec.budget * 1000 * BUDGET_SHARE;
    if (samples === null) film.calibrate(deadline - performance.now());
    let current = film.samples;
    await api.startFilm(job, { frames: film.frames, samples: current, landings: film.landings() });
    let upload: Promise<void> = Promise.resolve();
    let since = performance.now();
    for (let i = 0; i < film.frames; i++) {
      if (samples === null && i > 0 && i % WINDOW === 0) {
        const now = performance.now();
        if (((now - since) / WINDOW) * (film.frames - i) > deadline - now) current = Math.max(current - 1, 1);
        since = now;
      }
      const { data } = film.pixels(i, current);
      await upload;
      upload = api.putFrame(job, i, data, current).then((r) => {
        if (!r.ok) throw new Error(`The server refused frame ${i} (${r.status})`);
      });
      log(`frame ${i + 1} / ${film.frames}`);
    }
    await upload;
    log("done");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    await api.failFilm(job, message).catch(() => undefined);
  } finally {
    film?.dispose();
  }
}
