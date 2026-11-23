/** The stage's own size in px, and the scale that fits it to the frame (1 while exporting). */
export const stageSize = { width: 1920, height: 1080, fit: 1 };

export const stageElement = (): HTMLElement | null => document.getElementById('stage');
