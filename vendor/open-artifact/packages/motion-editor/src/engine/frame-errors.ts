/** Why a pull from the stage gave no frame. Pure. */

/** The stage could not give the frame. `hold`: the frame before may stand in. `env`: the browser's doing, not the film's. */
export class StageFrameError extends Error {
  override name = 'StageFrameError';
  readonly hold: boolean;
  readonly env: boolean;

  constructor(message: string, failure: { hold: boolean; env: boolean }) {
    super(message);
    this.hold = failure.hold;
    this.env = failure.env;
  }
}

/** No film is on the stage any more, so no frame can come. */
export class StageGoneError extends Error {
  override name = 'StageGoneError';
}
