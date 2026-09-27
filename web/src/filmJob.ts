import { api } from "./api";
import { FilmRenderer } from "./film";

/** Share of the budget calibration plans for, leaving room for loading and uneven frames. */
const BUDGET_SHARE = 0.9;

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
    if (samples === null) film.calibrate(spec.budget * 1000 * BUDGET_SHARE);
    await api.startFilm(job, { frames: film.frames, samples: film.samples, landings: film.landings() });
    let upload: Promise<void> = Promise.resolve();
    for (let i = 0; i < film.frames; i++) {
      const { data } = film.pixels(i);
      await upload;
      upload = api.putFrame(job, i, data).then((r) => {
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
