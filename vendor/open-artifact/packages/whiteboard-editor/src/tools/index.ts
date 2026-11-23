/**
 * Registers every board tool with the gesture framework. Import this module
 * once (for its side effect) before the surface takes presses.
 */

import { registerTool } from './gesture.ts';
import './hand.ts';
import { arrowPress } from './arrow.ts';
import { containerPress, notePress, shapePress, tablePress, textPress } from './blocks.ts';
import { penPress } from './pen.ts';
import { selectPress } from './select.ts';
import { stickerPress } from './sticker.ts';

registerTool('select', selectPress);
registerTool('note', notePress);
registerTool('text', textPress);
registerTool('shape', shapePress);
registerTool('container', containerPress);
registerTool('table', tablePress);
registerTool('pen', penPress);
registerTool('arrow', arrowPress);
registerTool('sticker', stickerPress);

export { installHover } from './hover.ts';
export { placeSticker, createStickerAt } from './sticker.ts';
