declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** The film's own time: what a scene's `render(t)`, score events and `T.<id>` use. */
export type FilmSeconds = Brand<number, 'FilmSeconds'>;
/** Play time: the film as the viewer sees it, after the scenes retimed by hand (recut). */
export type PlaySeconds = Brand<number, 'PlaySeconds'>;
export type FilmMs = Brand<number, 'FilmMs'>;
/** A fraction of the frame × 10 000. */
export type Permyriad = Brand<number, 'Permyriad'>;

export const filmSeconds = (value: number): FilmSeconds => value as FilmSeconds;
export const playSeconds = (value: number): PlaySeconds => value as PlaySeconds;
export const filmMs = (value: number): FilmMs => value as FilmMs;
export const permyriad = (value: number): Permyriad => value as Permyriad;
