/** The stage runtime's script text, from the `motionStageRuntime()` Vite plugin. */
declare module 'virtual:motion-stage-runtime' {
  const runtime: string;
  export default runtime;
}

/** The standalone player's script text (it mounts the runtime the page keeps), from the `motionStageRuntime()` Vite plugin. */
declare module 'virtual:motion-stage-player' {
  const player: string;
  export default player;
}
