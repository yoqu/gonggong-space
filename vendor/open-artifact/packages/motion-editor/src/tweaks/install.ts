import { createElement } from 'react';
import { registerPanel } from '../panels/registry.ts';
import { installRecut } from '../recut/install.ts';
import { installText } from '../text/install.ts';
import { registerSceneMenuItem, SCENE_MENU_ORDER } from '../timeline/scene-menu.ts';
import { registerToolbarItem, TOOLBAR_ORDER } from '../transport/slots.ts';
import { TWEAKS_PANEL } from './panel-id.ts';
import { SceneLengthItems, SceneNameItems, SceneSpeedItems } from './SceneMenuItems.tsx';
import { TweaksButton } from './TweaksButton.tsx';
import { TweaksPanel } from './TweaksPanel.tsx';
import { PROPERTIES } from './words.ts';

/** The Properties panel (once Tweaks) and its toolbar button, the scene menu's name, length and speed, and the text editing and scene recut they drive. */
export function installTweaks(): () => void {
  const stops = [
    registerPanel({ id: TWEAKS_PANEL, label: PROPERTIES, order: TOOLBAR_ORDER.tweaks, render: () => createElement(TweaksPanel) }),
    registerToolbarItem({ id: TWEAKS_PANEL, side: 'end', order: TOOLBAR_ORDER.tweaks, render: () => createElement(TweaksButton) }),
    registerSceneMenuItem({ id: 'scene-name', order: SCENE_MENU_ORDER.name, writes: true, render: (context) => createElement(SceneNameItems, context) }),
    registerSceneMenuItem({ id: 'scene-length', order: SCENE_MENU_ORDER.length, writes: true, render: (context) => createElement(SceneLengthItems, context) }),
    registerSceneMenuItem({ id: 'scene-speed', order: SCENE_MENU_ORDER.speed, writes: true, render: (context) => createElement(SceneSpeedItems, context) }),
    installText(),
    installRecut(),
  ];
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
