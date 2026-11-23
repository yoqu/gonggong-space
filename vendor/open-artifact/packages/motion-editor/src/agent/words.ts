export const REQUEST_SUBJECT = 'this animation';
export const SAY_CONTINUE = 'Continue';
export const SAY_FINALIZE = 'Finalize';
export const FIX_ERROR_TITLE = 'Fix the error';
export const errorWhere = (phase: 'load' | 'render'): string => (phase === 'load' ? 'while loading the code' : 'while rendering a frame');
export const fixErrorText = (where: string, at: string | null): string =>
  `The animation stopped with an error ${where}${at === null ? '' : ` at ${at}`}. Find what causes it and fix it.`;
export const ERROR_LABEL = 'Error message';
