/** Brief camera moves happen before any blocks in the next step appear. */
export const CAMERA_MOVE_SECONDS = 0.3;
export const replayDelay = (step: number, speed: number) => (step < 0 ? 400 : 80) / speed;
