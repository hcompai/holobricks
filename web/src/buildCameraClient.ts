import { restoreCameraPlan, type BuildCameraPlan, type CameraPlanData } from "./buildCamera";
import type { CameraRequest } from "./buildCameraWorker";

/** Keep angle selection and transformed bounds off the interactive render thread. */
export class BuildCameraClient {
  private worker: Worker | null = null;
  private id = 0;
  private jobs = new Map<number, { resolve: (plan: BuildCameraPlan | null) => void; reject: (error: Error) => void }>();

  plan(request: Omit<CameraRequest, "id">): Promise<BuildCameraPlan | null> {
    if (!this.worker) {
      this.worker = new Worker(new URL("./buildCameraWorker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = ({
        data,
      }: MessageEvent<{ id: number; plan?: CameraPlanData | null; error?: string }>) => {
        const job = this.jobs.get(data.id);
        this.jobs.delete(data.id);
        if (data.error) job?.reject(new Error(data.error));
        else job?.resolve(data.plan ? restoreCameraPlan(data.plan) : null);
      };
      this.worker.onerror = () => this.dispose();
    }
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker!.postMessage({ ...request, id }, [request.pieces.buffer, request.templates.buffer]);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) job.reject(new Error("Camera planner stopped"));
    this.jobs.clear();
  }
}
