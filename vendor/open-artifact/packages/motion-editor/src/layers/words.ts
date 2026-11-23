/** The words of the Layers section, its Appearance, Text styles and Animate groups, and the picture's selection. */

export const LAYERS_TITLE = 'Layers';
export const PAUSE_TO_SEE_LAYERS = 'Pause to see the layers.';
export const READING_LAYERS = 'Reading…';
export const NO_LAYERS = 'No layers found here.';
export const COULD_NOT_READ_LAYERS = 'Couldn’t read the layers.';
export const COULD_NOT_UPDATE_LAYERS = 'Couldn’t update the layers.';
export const TRY_AGAIN = 'Try again';
export const LAYER_TREE_LABEL = 'Layers at this moment';
export const DESELECT_LAYER = 'Deselect the layer';
export const HIDE = 'Hide';
export const SHOW = 'Show';
export const hideLayer = (name: string): string => `Hide ${name}`;
export const showLayer = (name: string): string => `Show ${name}`;
export const ofSiblings = (name: string, n: number, of: number): string => `${name}, ${n} of ${of}`;
export const itemCount = (count: number): string => (count === 1 ? '1 item' : `${count} items`);
export const OFF_PICTURE = 'not on the picture now';
export const HIDDEN_ROW = 'hidden';
export const hiddenWith = (name: string): string => `hidden with ${name}`;

/** What the list calls a layer that has no name of its own. */
export const KIND_LABELS = {
  text: 'Text',
  image: 'Image',
  shape: 'Rectangle',
  group: 'Group',
  ground: 'Background',
} as const;
export const OVAL = 'Oval';
export const DRAWN_LABELS = {
  graphic: 'Graphic',
  drawing: 'Graphic',
  group: 'Group',
  line: 'Line',
  path: 'Path',
  polygon: 'Polygon',
} as const;

// Appearance
export const APPEARANCE_TITLE = 'Appearance';
export const FILL = 'Fill';
export const STROKE = 'Stroke';
export const COLOR = 'Color';
export const colorN = (n: number): string => `Color ${n}`;
export const SCALE = 'Scale';
export const RADIUS = 'Radius';
export const RESET = 'Reset';
export const resetWhat = (what: string): string => `Reset ${what.toLowerCase()}`;
export const IN_THIS_ANIMATION = 'In this animation';
export const MIXED = 'Mixed';

// Text styles
export const TEXT_STYLES_TITLE = 'Text styles';
export const BOLD = 'Bold';
export const ITALIC = 'Italic';
export const WEIGHT = 'Weight';
export const EMPHASIS = 'Emphasis';
export const FONT_SIZE = 'Font size';
export const SPACING = 'Spacing';
export const LINE_HEIGHT = 'Line height';
export const LETTER_SPACING = 'Letter spacing';
export const LETTER_SPACING_SHORT = 'Spacing';
export const TEXT_COLOR = 'Text color';
export const ALIGNMENT = 'Alignment';
export const AUTO = 'Auto';
export const ALIGN_LABELS = { left: 'Left', center: 'Center', right: 'Right', justify: 'Justify' } as const;
export const RESET_TEXT_STYLES = 'Reset these words to the animation’s own styles';
export const NOTHING_TO_RESET = 'Nothing to reset';
export const READING_STYLES = 'Reading the styles…';
export const COULD_NOT_READ_STYLES = 'Couldn’t read these words’ styles.';
export const WEIGHT_NAMES: Readonly<Record<number, string>> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};
export const weightName = (weight: number): string => WEIGHT_NAMES[weight] ?? String(weight);

// Problems writing by hand
export const RECORD_FULL =
  'This animation holds as many changes made by hand as it can. To make room, reset one where it was made, or use “Reset all changes” in Properties.';
export const CHANGE_STALE = 'That change couldn’t be saved because the animation changed meanwhile. Make it again.';
export const CANNOT_WRITE = 'This animation can’t be changed here.';
export const ONLY_FINAL = 'Changes by hand apply to finished scenes only.';
export const hiddenMayShow = (count: number): string =>
  count === 1
    ? 'A layer that was hidden may be showing again, since the animation has changed. Hide it again if you want it hidden.'
    : `${count} layers that were hidden may be showing again, since the animation has changed. Hide them again if you want them hidden.`;

// Undo labels
export const undoLabel = (what: string): string => `Change ${what.toLowerCase()}`;
export const UNDO_HIDE = 'Hide a layer';
export const UNDO_SHOW = 'Show a layer';
export const UNDO_RESET = 'Reset a layer';

// Animate
export const ANIMATE_TITLE = 'Animate';
export const COMES_IN = 'Comes in';
export const LEAVES = 'Leaves';
export const TIMING = 'Timing';
/** A slide's side, said in full to a screen reader; the row shows From and To. */
export const SLIDES_IN_FROM = 'Slides in from';
export const SLIDES_OUT_TO = 'Slides out to';
export const FROM = 'From';
export const TO = 'To';
export const LAYER_SPEED = 'Layer speed';
export const LAYER_SPEED_SHORT = 'Speed';
export const ENTER_LABELS = { fade: 'Fade', slide: 'Slide', pop: 'Pop', type: 'Type' } as const;
export const LEAVE_LABELS = { fade: 'Fade', slide: 'Slide', shrink: 'Shrink', stay: 'Stays' } as const;
export const SIDE_LABELS = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' } as const;
export const WHEN_LABELS = { earlier: 'Earlier', later: 'Later' } as const;
export const PACE_LABELS = { slower: 'Slower', faster: 'Faster' } as const;
/** The first item of a picker's menu: leave this as the animation has it. */
export const NO_CHANGE = 'No change';
export const ASK_THE_AGENT = 'Ask the agent';
export const STILL_UPDATING = 'The animation is still updating. Try again in a moment.';
export const WHAT_THE_AGENT_READS = 'What the agent will read';
export const CLEAR_CHOICE = 'Clear';
export const NOT_ON_PICTURE = 'This layer isn’t on the picture now. Go to it so the agent can tell which one you mean.';
export const GO_TO_IT = 'Go to it';
export const AGENT_WORKING = 'The agent is working. Ask when it’s done.';
export const PICK_A_CHANGE = 'Pick how it should move, then ask the agent.';
export const makeThis = (kind: string, changes: string): string => `Make this ${kind} ${changes}.`;
export const makeEach = (count: number, changes: string): string => `Make each of these ${count} ${changes}.`;
