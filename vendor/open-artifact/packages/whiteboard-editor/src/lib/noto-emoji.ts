/**
 * Noto emoji art for emoji stickers, from Google's Noto Emoji Animation
 * (https://googlefonts.github.io/noto-emoji-animation/), served by
 * fonts.gstatic.com:
 *
 * - `emoji.svg`: the still Noto art, for any emoji;
 * - `512.webp`: the animated art, for the emoji in {@link ANIMATED}.
 *
 * An emoji is named by its code points in lowercase hex joined by `_`
 * (`2764_fe0f` for ❤️), as the service names them.
 */

import { FACE_STICKER_ART, iconStickerOf, isEmojiStickerArt, STICKER_EMOJI } from '@open-artifact/whiteboard-core';

const BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest';

/** Emoji the service animates (its `data/api.json`), by code point name. */
const ANIMATED: ReadonlySet<string> = new Set(
  [
    '1f192 1f193 1f195 1f197 1f198 1f199 1f300 1f304 1f305 1f307 1f308 1f30a 1f30b 1f30c 1f30d 1f30e 1f30f 1f31a',
    '1f31b 1f31c 1f31d 1f31e 1f31f 1f321_fe0f 1f327_fe0f 1f329_fe0f 1f32a_fe0f 1f32c_fe0f 1f32d 1f32e 1f32f 1f331',
    '1f332 1f335 1f337 1f338 1f339 1f33c 1f33d 1f33f 1f340 1f341 1f342 1f343 1f344 1f345 1f347 1f348 1f349 1f34a',
    '1f34b 1f34d 1f34e 1f350 1f352 1f353 1f354 1f355 1f357 1f35c 1f35d 1f35e 1f361 1f362 1f366 1f368 1f369 1f36a',
    '1f373 1f375 1f377 1f379 1f37b 1f37c 1f37d_fe0f 1f37e 1f37f 1f381 1f382 1f386 1f388 1f389 1f38a 1f393',
    '1f39e_fe0f 1f39f_fe0f 1f3a0 1f3a1 1f3a2 1f3a3 1f3ac 1f3ad 1f3af 1f3b0 1f3b1 1f3b2 1f3b3 1f3b6 1f3b7 1f3b8',
    '1f3ba 1f3bb 1f3be 1f3bf 1f3c0 1f3c1 1f3c6 1f3c9 1f3cd_fe0f 1f3ce_fe0f 1f3cf 1f3d1 1f3d2 1f3d3 1f3d5_fe0f',
    '1f3da_fe0f 1f3de_fe0f 1f3e0 1f3f3_fe0f 1f3f4 1f3f8 1f400 1f402 1f405 1f407 1f409 1f40a 1f40c 1f40d 1f40e 1f410',
    '1f412 1f413 1f415 1f415_200d_1f9ba 1f416 1f419 1f41b 1f41c 1f41d 1f41e 1f41f 1f421 1f422 1f423 1f424 1f425',
    '1f426 1f426_200d_1f525 1f426_200d_2b1b 1f427 1f429 1f42c 1f42e 1f433 1f438 1f43a 1f43b 1f43c 1f43e 1f43f_fe0f',
    '1f440 1f441_fe0f 1f442 1f442_1f3fb 1f442_1f3fc 1f442_1f3fd 1f442_1f3fe 1f442_1f3ff 1f443 1f443_1f3fb',
    '1f443_1f3fc 1f443_1f3fd 1f443_1f3fe 1f443_1f3ff 1f446 1f446_1f3fb 1f446_1f3fc 1f446_1f3fd 1f446_1f3fe',
    '1f446_1f3ff 1f447 1f447_1f3fb 1f447_1f3fc 1f447_1f3fd 1f447_1f3fe 1f447_1f3ff 1f448 1f448_1f3fb 1f448_1f3fc',
    '1f448_1f3fd 1f448_1f3fe 1f448_1f3ff 1f449 1f449_1f3fb 1f449_1f3fc 1f449_1f3fd 1f449_1f3fe 1f449_1f3ff 1f44a',
    '1f44a_1f3fb 1f44a_1f3fc 1f44a_1f3fd 1f44a_1f3fe 1f44a_1f3ff 1f44b 1f44b_1f3fb 1f44b_1f3fc 1f44b_1f3fd',
    '1f44b_1f3fe 1f44b_1f3ff 1f44c 1f44c_1f3fb 1f44c_1f3fc 1f44c_1f3fd 1f44c_1f3fe 1f44c_1f3ff 1f44d 1f44d_1f3fb',
    '1f44d_1f3fc 1f44d_1f3fd 1f44d_1f3fe 1f44d_1f3ff 1f44e 1f44e_1f3fb 1f44e_1f3fc 1f44e_1f3fd 1f44e_1f3fe',
    '1f44e_1f3ff 1f44f 1f44f_1f3fb 1f44f_1f3fc 1f44f_1f3fd 1f44f_1f3fe 1f44f_1f3ff 1f450 1f450_1f3fb 1f450_1f3fc',
    '1f450_1f3fd 1f450_1f3fe 1f450_1f3ff 1f451 1f45f 1f460 1f463 1f479 1f47b 1f47d 1f47e 1f47f 1f480 1f483',
    '1f483_1f3fb 1f483_1f3fc 1f483_1f3fd 1f483_1f3fe 1f483_1f3ff 1f485 1f485_1f3fb 1f485_1f3fc 1f485_1f3fd',
    '1f485_1f3fe 1f485_1f3ff 1f48b 1f48c 1f48d 1f48e 1f490 1f493 1f494 1f495 1f496 1f497 1f498 1f499 1f49a 1f49b',
    '1f49c 1f49d 1f49e 1f49f 1f4a1 1f4a3 1f4a5 1f4a7 1f4a9 1f4aa 1f4aa_1f3fb 1f4aa_1f3fc 1f4aa_1f3fd 1f4aa_1f3fe',
    '1f4aa_1f3ff 1f4ac 1f4af 1f4b8 1f4bb 1f4bf 1f4c8 1f4c9 1f4ca 1f4da 1f4df 1f4e3 1f4e6 1f4f4 1f4f7 1f4f8 1f4fa',
    '1f50b 1f50c 1f50e 1f512 1f514 1f525 1f52e 1f54a_fe0f 1f573_fe0f 1f577_fe0f 1f587_fe0f 1f590_1f3fb 1f590_1f3fc',
    '1f590_1f3fd 1f590_1f3fe 1f590_1f3ff 1f590_fe0f 1f595 1f595_1f3fb 1f595_1f3fc 1f595_1f3fd 1f595_1f3fe',
    '1f595_1f3ff 1f596 1f596_1f3fb 1f596_1f3fc 1f596_1f3fd 1f596_1f3fe 1f596_1f3ff 1f5a4 1f5a8_fe0f 1f5d1_fe0f',
    '1f5e3_fe0f 1f5ef_fe0f 1f5f3_fe0f 1f5ff 1f600 1f601 1f602 1f603 1f604 1f605 1f606 1f607 1f608 1f609 1f60a 1f60b',
    '1f60c 1f60d 1f60e 1f60f 1f610 1f611 1f612 1f613 1f614 1f615 1f616 1f617 1f618 1f619 1f61a 1f61b 1f61c 1f61d',
    '1f61e 1f61f 1f620 1f621 1f622 1f623 1f624 1f625 1f626 1f627 1f628 1f629 1f62a 1f62b 1f62c 1f62d 1f62e',
    '1f62e_200d_1f4a8 1f62f 1f630 1f631 1f632 1f633 1f634 1f635 1f635_200d_1f4ab 1f636 1f636_200d_1f32b_fe0f 1f637',
    '1f638 1f639 1f63a 1f63b 1f63c 1f63d 1f63e 1f63f 1f640 1f641 1f642 1f642_200d_2194_fe0f 1f642_200d_2195_fe0f',
    '1f643 1f644 1f648 1f649 1f64a 1f64c 1f64c_1f3fb 1f64c_1f3fc 1f64c_1f3fd 1f64c_1f3fe 1f64c_1f3ff 1f64f',
    '1f64f_1f3fb 1f64f_1f3fc 1f64f_1f3fd 1f64f_1f3fe 1f64f_1f3ff 1f680 1f682 1f68c 1f695 1f697 1f69a 1f69c 1f6a6',
    '1f6a7 1f6a8 1f6a9 1f6ae 1f6b2 1f6ce_fe0f 1f6d1 1f6d2 1f6d8 1f6df 1f6e0_fe0f 1f6eb 1f6ec 1f6f6 1f6f8 1f6f9',
    '1f6fc 1f90c 1f90c_1f3fb 1f90c_1f3fc 1f90c_1f3fd 1f90c_1f3fe 1f90c_1f3ff 1f90d 1f90e 1f90f 1f90f_1f3fb',
    '1f90f_1f3fc 1f90f_1f3fd 1f90f_1f3fe 1f90f_1f3ff 1f910 1f911 1f912 1f913 1f914 1f915 1f916 1f917 1f918',
    '1f918_1f3fb 1f918_1f3fc 1f918_1f3fd 1f918_1f3fe 1f918_1f3ff 1f919 1f919_1f3fb 1f919_1f3fc 1f919_1f3fd',
    '1f919_1f3fe 1f919_1f3ff 1f91a 1f91a_1f3fb 1f91a_1f3fc 1f91a_1f3fd 1f91a_1f3fe 1f91a_1f3ff 1f91b 1f91b_1f3fb',
    '1f91b_1f3fc 1f91b_1f3fd 1f91b_1f3fe 1f91b_1f3ff 1f91c 1f91c_1f3fb 1f91c_1f3fc 1f91c_1f3fd 1f91c_1f3fe',
    '1f91c_1f3ff 1f91d 1f91d_1f3fb 1f91d_1f3fc 1f91d_1f3fd 1f91d_1f3fe 1f91d_1f3ff 1f91e 1f91e_1f3fb 1f91e_1f3fc',
    '1f91e_1f3fd 1f91e_1f3fe 1f91e_1f3ff 1f91f 1f91f_1f3fb 1f91f_1f3fc 1f91f_1f3fd 1f91f_1f3fe 1f91f_1f3ff 1f920',
    '1f921 1f922 1f923 1f924 1f925 1f927 1f928 1f929 1f92a 1f92b 1f92c 1f92d 1f92e 1f92f 1f932 1f932_1f3fb',
    '1f932_1f3fc 1f932_1f3fd 1f932_1f3fe 1f932_1f3ff 1f933 1f933_1f3fb 1f933_1f3fc 1f933_1f3fd 1f933_1f3fe',
    '1f933_1f3ff 1f940 1f941 1f942 1f947 1f948 1f949 1f94b 1f94d 1f94e 1f94f 1f951 1f952 1f953 1f954 1f955 1f957',
    '1f95d 1f95e 1f962 1f966 1f967 1f968 1f96c 1f96d 1f970 1f971 1f972 1f973 1f974 1f975 1f976 1f978 1f979 1f97a',
    '1f980 1f981 1f982 1f984 1f985 1f987 1f988 1f989 1f98a 1f98b 1f98d 1f98e 1f994 1f995 1f996 1f997 1f998 1f99a',
    '1f99d 1f99e 1f99f 1f9a0 1f9a5 1f9a6 1f9a7 1f9a9 1f9ad 1f9ae 1f9b4 1f9b5 1f9b5_1f3fb 1f9b5_1f3fc 1f9b5_1f3fd',
    '1f9b5_1f3fe 1f9b5_1f3ff 1f9b6 1f9b6_1f3fb 1f9b6_1f3fc 1f9b6_1f3fd 1f9b6_1f3fe 1f9b6_1f3ff 1f9bb 1f9bb_1f3fb',
    '1f9bb_1f3fc 1f9bb_1f3fd 1f9bb_1f3fe 1f9bb_1f3ff 1f9be 1f9bf 1f9c0 1f9c2 1f9c3 1f9c4 1f9c5 1f9c9 1f9cb 1f9d0',
    '1f9e0 1f9e1 1f9e6 1f9f9 1fa70 1fa75 1fa76 1fa77 1fa78 1fa7a 1fa81 1fa82 1fa83 1fa84 1fa85 1fa87 1fa89 1fa8a',
    '1fa8e 1fa8f 1fa90 1fa94 1fa95 1fa99 1faa4 1faa8 1faa9 1faab 1faad 1fab0 1fab1 1fab3 1fab7 1fabb 1fabc 1fabe',
    '1fabf 1fac0 1fac2 1fac6 1fac8 1facd 1facf 1fad0 1fad1 1fad6 1fad7 1fad8 1fada 1fadb 1fadc 1fadf 1fae0 1fae1',
    '1fae2 1fae3 1fae4 1fae5 1fae6 1fae7 1fae8 1fae9 1faea 1faef 1faf0 1faf0_1f3fb 1faf0_1f3fc 1faf0_1f3fd',
    '1faf0_1f3fe 1faf0_1f3ff 1faf1 1faf1_1f3fb 1faf1_1f3fb_200d_1faf2_1f3fc 1faf1_1f3fb_200d_1faf2_1f3fd',
    '1faf1_1f3fb_200d_1faf2_1f3fe 1faf1_1f3fb_200d_1faf2_1f3ff 1faf1_1f3fc 1faf1_1f3fc_200d_1faf2_1f3fb',
    '1faf1_1f3fc_200d_1faf2_1f3fd 1faf1_1f3fc_200d_1faf2_1f3fe 1faf1_1f3fc_200d_1faf2_1f3ff 1faf1_1f3fd',
    '1faf1_1f3fd_200d_1faf2_1f3fb 1faf1_1f3fd_200d_1faf2_1f3fc 1faf1_1f3fd_200d_1faf2_1f3fe',
    '1faf1_1f3fd_200d_1faf2_1f3ff 1faf1_1f3fe 1faf1_1f3fe_200d_1faf2_1f3fb 1faf1_1f3fe_200d_1faf2_1f3fc',
    '1faf1_1f3fe_200d_1faf2_1f3fd 1faf1_1f3fe_200d_1faf2_1f3ff 1faf1_1f3ff 1faf1_1f3ff_200d_1faf2_1f3fb',
    '1faf1_1f3ff_200d_1faf2_1f3fc 1faf1_1f3ff_200d_1faf2_1f3fd 1faf1_1f3ff_200d_1faf2_1f3fe 1faf2 1faf2_1f3fb',
    '1faf2_1f3fc 1faf2_1f3fd 1faf2_1f3fe 1faf2_1f3ff 1faf3 1faf3_1f3fb 1faf3_1f3fc 1faf3_1f3fd 1faf3_1f3fe',
    '1faf3_1f3ff 1faf4 1faf4_1f3fb 1faf4_1f3fc 1faf4_1f3fd 1faf4_1f3fe 1faf4_1f3ff 1faf5 1faf5_1f3fb 1faf5_1f3fc',
    '1faf5_1f3fd 1faf5_1f3fe 1faf5_1f3ff 1faf6 1faf6_1f3fb 1faf6_1f3fc 1faf6_1f3fd 1faf6_1f3fe 1faf6_1f3ff 1faf7',
    '1faf7_1f3fb 1faf7_1f3fc 1faf7_1f3fd 1faf7_1f3fe 1faf7_1f3ff 1faf8 1faf8_1f3fb 1faf8_1f3fc 1faf8_1f3fd',
    '1faf8_1f3fe 1faf8_1f3ff 203c_fe0f 2049_fe0f 2122_fe0f 231b 23f0 23f3 2601_fe0f 2602_fe0f 2603_fe0f 2604_fe0f',
    '2615 261d_1f3fb 261d_1f3fc 261d_1f3fd 261d_1f3fe 261d_1f3ff 261d_fe0f 2622_fe0f 2623_fe0f 262e_fe0f 262f_fe0f',
    '2639_fe0f 263a_fe0f 2648 2649 264a 264b 264c 264d 264e 264f 2650 2651 2652 2653 265f_fe0f 2660_fe0f 2665_fe0f',
    '2668_fe0f 267e_fe0f 2693 2696_fe0f 2699_fe0f 26a0_fe0f 26a1 26bd 26be 26c4 26c5 26ce 26d3_fe0f',
    '26d3_fe0f_200d_1f4a5 26f3 26f5 26f8_fe0f 26fd 2702_fe0f 2705 2708_fe0f 270a 270a_1f3fb 270a_1f3fc 270a_1f3fd',
    '270a_1f3fe 270a_1f3ff 270b 270b_1f3fb 270b_1f3fc 270b_1f3fd 270b_1f3fe 270b_1f3ff 270c_1f3fb 270c_1f3fc',
    '270c_1f3fd 270c_1f3fe 270c_1f3ff 270c_fe0f 270d_1f3fb 270d_1f3fc 270d_1f3fd 270d_1f3fe 270d_1f3ff 270d_fe0f',
    '270f_fe0f 2728 2744_fe0f 274c 2753 2757 2763_fe0f 2764_fe0f 2764_fe0f_200d_1f525 2764_fe0f_200d_1fa79 2795',
    '2b50 a9_fe0f ae_fe0f',
  ]
    .join(' ')
    .split(' '),
);

/** `glyph`'s code point name (`1f44d`), with or without its variation selectors. */
function codeName(glyph: string, selectors: boolean): string {
  return [...glyph]
    .map((char) => char.codePointAt(0)!)
    .filter((code) => selectors || code !== 0xfe0f)
    .map((code) => code.toString(16))
    .join('_');
}

/** Noto art for an emoji: the still `svg` and, when the emoji is animated, the `animated` webp. */
export interface NotoEmojiArt {
  svg: string;
  animated?: string;
}

/** The Noto art URLs of `glyph` (undefined for an empty glyph). */
export function notoEmojiArt(glyph: string): NotoEmojiArt | undefined {
  if (glyph === '') return undefined;
  const exact = codeName(glyph, true);
  const plain = codeName(glyph, false);
  const name = ANIMATED.has(exact) ? exact : ANIMATED.has(plain) ? plain : ANIMATED.has(`${plain}_fe0f`) ? `${plain}_fe0f` : undefined;
  return { svg: `${BASE}/${exact}/emoji.svg`, ...(name ? { animated: `${BASE}/${name}/512.webp` } : {}) };
}

/** The emoji an emoji sticker shows (a named key's, or its bare glyph); undefined for face and icon stickers. */
export function stickerEmoji(sticker: { art?: string | undefined; glyph?: string | undefined }): string | undefined {
  const { art, glyph } = sticker;
  if (art === FACE_STICKER_ART || iconStickerOf(art) !== undefined) return undefined;
  const emoji = art !== undefined && isEmojiStickerArt(art) ? STICKER_EMOJI[art] : glyph;
  return emoji === '' ? undefined : emoji;
}

/** True when a sticker shows an animated Noto emoji. */
export function isAnimatedEmojiSticker(sticker: { art?: string | undefined; glyph?: string | undefined }): boolean {
  const emoji = stickerEmoji(sticker);
  return emoji !== undefined && notoEmojiArt(emoji)?.animated !== undefined;
}

/** The key of an emoji's still Noto art in the painters' sticker art map. */
export function emojiArtKey(glyph: string): string {
  return `emoji:${glyph}`;
}
