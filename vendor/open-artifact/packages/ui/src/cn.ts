import { clsx, type ClassValue } from 'clsx';

/** Joins class names, dropping falsy values. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
