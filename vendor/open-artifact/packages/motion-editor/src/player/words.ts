export const NO_ANIMATION = 'No animation yet';
export const PLAYS_HERE_YOURS = 'Your animation plays here when it’s ready.';
export const PLAYS_HERE = 'It plays here when it’s ready.';
export const NOTHING_TO_PLAY = 'Nothing to play yet. Your animation will show up here.';
export const LOADING = 'Loading the animation…';
export const STOPPED_WITH_ERROR = 'The animation stopped with an error';
export const IN_LOADING = 'It happened while loading the code.';
export const IN_RENDERING = 'It happened while rendering a frame.';
export const failedAt = (time: string): string => `The animation’s code failed at ${time}:`;
export const askToFix = (agent: string): string => `Ask ${agent} to fix it`;
export const STOPPED_ASK = (agent: string): string => `The animation has stopped with an error. Ask ${agent} to fix it.`;
export const COMING_UP = 'Coming up';
export const NOT_MADE_YET = 'Not made yet';
export const gettingStarted = (agent: string): string => `${agent} is getting started`;
export const makingIt = (agent: string): string => `${agent} is making your animation`;
export const seemsStopped = (agent: string): string => `${agent} seems to have stopped`;
export const LIVE_SYNC_UNAVAILABLE = 'Live sync is unavailable here. Reload to retry.';
export const RELOAD = 'Reload';
export const WAITING_FOR_YOU = 'Waiting for you';
export const waitsForYou = (agent: string): string => `${agent} is waiting for you.`;
export const ROUGH_CUT = 'Rough cut';
export const SCENES = 'Scenes';
export const NOT_FINISHED = 'Not finished yet';
export const FINISHING_UP = 'Finishing up';
export const CONTINUE = 'Continue';
export const FINALIZE = 'Finalize';
export const scenesMade = (done: number, total: number): string => `${done} of ${total} scenes`;
export const scenesFinalized = (done: number, total: number): string => `${done} of ${total} finalized`;
export const scenesMissing = (count: number): string => (count === 1 ? '1 scene missing' : `${count} scenes missing`);
export const PLAY_AGAIN = 'Play again';
export const ANOTHER_SHAPE = 'Make it in another shape';
export const shapeLabel = (ratio: string, name: string): string => `${name} (${ratio})`;
export const SHAPE_NAMES: Readonly<Record<'wide' | 'vertical' | 'square' | 'portrait', string>> = {
  wide: 'Wide',
  vertical: 'Vertical',
  square: 'Square',
  portrait: 'Portrait',
};
export const ANIMATION_READY = 'The animation is ready';
export const ANIMATION_UPDATED = 'Animation updated';
export const DISMISS = 'Dismiss';
