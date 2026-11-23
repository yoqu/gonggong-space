import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cameraLayerTransform,
  centerOn,
  clampZoom,
  fitRect,
  nextZoomStep,
  panBy,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAround,
  zoomPercent,
} from '../src/camera.ts';

test('screen and world points round-trip through the camera', () => {
  const camera = { x: 100, y: -40, zoom: 2 };
  const screen = worldToScreen(camera, { x: 150, y: 10 });
  assert.deepEqual(screen, { x: 100, y: 100 });
  assert.deepEqual(screenToWorld(camera, screen), { x: 150, y: 10 });
  assert.deepEqual(visibleRect(camera, 800, 600), { x: 100, y: -40, w: 400, h: 300 });
});

test('zooming around a point keeps it under the pointer', () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  const anchor = { x: 200, y: 100 };
  const before = screenToWorld(camera, anchor);
  const zoomed = zoomAround(camera, 4, anchor);
  assert.deepEqual(screenToWorld(zoomed, anchor), before);
  assert.deepEqual(panBy(zoomed, 40, -20), { zoom: 4, x: zoomed.x - 10, y: zoomed.y + 5 });
});

test('zoom steps stay within the limits and skip near-equal steps', () => {
  assert.equal(nextZoomStep(1, 1, 0.05, 8), 1.25);
  assert.equal(nextZoomStep(0.997, 1, 0.05, 8), 1.25);
  assert.equal(nextZoomStep(7, 1, 0.05, 8), 8);
  assert.equal(nextZoomStep(0.06, -1, 0.05, 8), 0.05);
  // A tight epsilon treats 0.997 as below 100% (the Design editor's stepping).
  assert.equal(nextZoomStep(0.997, 1, 0.01, 8, 1e-6), 1);
  assert.equal(nextZoomStep(0.015, -1, 0.01, 8, 1e-6), 0.01);
  assert.equal(clampZoom(20, 0.05, 8), 8);
});

test('fitting centers the rect within the insets and caps the zoom', () => {
  const camera = fitRect({ x: 0, y: 0, w: 100, h: 100 }, 1000, 800);
  assert.equal(camera.zoom, 1);
  assert.deepEqual(worldToScreen(camera, { x: 50, y: 50 }), { x: 500, y: 400 });
  const tight = fitRect({ x: 0, y: 0, w: 4000, h: 1000 }, 1000, 800, { padding: 0, insets: { top: 0, right: 0, bottom: 0, left: 200 } });
  assert.equal(tight.zoom, 0.2);
  assert.deepEqual(worldToScreen(tight, { x: 2000, y: 500 }), { x: 600, y: 400 });
  assert.equal(fitRect({ x: 0, y: 0, w: 1e6, h: 1e6 }, 1000, 800, { minZoom: 0.05 }).zoom, 0.05);
});

test('helpers for DOM layers and labels', () => {
  assert.deepEqual(centerOn({ x: 0, y: 0 }, 2, 400, 200), { zoom: 2, x: -100, y: -50 });
  assert.equal(cameraLayerTransform({ x: 10.3, y: 0, zoom: 1 }, 2), 'translate(-10.5px, 0px) scale(1)');
  assert.equal(zoomPercent(0.756), '76%');
});
