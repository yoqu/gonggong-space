// Two ports, two origins: the host stands in for the main site, the editor's server for the artifact's preview origin.
export const HOST_PORT = Number(process.env.OA_SPIKE_HOST_PORT ?? 4811)
export const EDITOR_PORT = Number(process.env.OA_SPIKE_EDITOR_PORT ?? 4812)
export const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`
export const EDITOR_ORIGIN = `http://localhost:${EDITOR_PORT}`
