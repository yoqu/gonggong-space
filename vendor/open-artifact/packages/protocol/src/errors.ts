/**
 * Errors on the wire.
 *
 * Every API answers a failure as `{ code, message, fix? }` (HTTP bodies, tool
 * results under `error`, JSON-RPC errors under `error.data`). A conflict may
 * add `current`: what the thing is now, for the caller to merge with.
 */

/** Error codes used across the protocol. Types may add their own. */
export type OpenArtifactErrorCode =
  | 'invalid_argument'
  | 'not_found'
  | 'unauthorized'
  | 'not_granted'
  | 'conflict'
  | 'too_large'
  | 'bad_path'
  | 'rate_limited'
  | 'unsupported'
  | 'unknown_action'
  | 'unknown_tool'
  | 'method_not_found'
  | 'type_missing'
  | 'type_not_runnable'
  | 'server_failed'
  | 'no_daemon'
  | 'daemon_failed'
  | 'connect_failed'
  | 'disconnected'
  | 'timeout'
  | 'error'
  | (string & {});

/** A failure as it travels. */
export interface OpenArtifactErrorBody {
  code: OpenArtifactErrorCode;
  message: string;
  /** What the caller can do about it, for agents. */
  fix?: string;
  /** For a conflict: what the conflicting thing is now. */
  current?: unknown;
}

/** A thrown error that carries a protocol code. */
export class OpenArtifactError extends Error {
  readonly code: OpenArtifactErrorCode;
  readonly fix?: string;
  /** HTTP status to answer with, when thrown inside an HTTP handler. */
  readonly status?: number;
  /** For a conflict: what the conflicting thing is now. */
  readonly current?: unknown;

  constructor(code: OpenArtifactErrorCode, message: string, options: { fix?: string; status?: number; current?: unknown } = {}) {
    super(message);
    this.name = 'OpenArtifactError';
    this.code = code;
    if (options.fix !== undefined) this.fix = options.fix;
    if (options.status !== undefined) this.status = options.status;
    if (options.current !== undefined) this.current = options.current;
  }

  /** The wire form. */
  toJSON(): OpenArtifactErrorBody {
    return { code: this.code, message: this.message, ...(this.fix ? { fix: this.fix } : {}), ...(this.current !== undefined ? { current: this.current } : {}) };
  }
}

/** Any thrown value → its wire form. */
export function errorBody(error: unknown): OpenArtifactErrorBody {
  if (error instanceof OpenArtifactError) return error.toJSON();
  // `extra` is where server-sdk's FrameError keeps its fix and current.
  const e = error as { code?: unknown; message?: unknown; fix?: unknown; current?: unknown; extra?: { fix?: unknown; current?: unknown } } | null;
  const fix = e?.fix ?? e?.extra?.fix;
  const current = e?.current ?? e?.extra?.current;
  return {
    code: typeof e?.code === 'string' ? e.code : 'error',
    message: typeof e?.message === 'string' ? e.message : String(error),
    ...(typeof fix === 'string' ? { fix } : {}),
    ...(current !== undefined ? { current } : {}),
  };
}
