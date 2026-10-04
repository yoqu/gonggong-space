<script setup>
import { withBase } from 'vitepress'
</script>

# Videos

Two videos: a quick overview, and a walkthrough of the main features. The narration is in Chinese.

## Product video (60 s)

<video controls preload="metadata" width="100%" :poster="withBase('/videos/promo.jpg')" :src="withBase('/videos/promo.mp4')"></video>

## Feature walkthrough: a new teammate's first day in eight levels (3 min 56 s)

<video controls preload="metadata" width="100%" :poster="withBase('/videos/explainer.jpg')" :src="withBase('/videos/explainer.mp4')"></video>

Next, read the [Quick Start](/en/guide/quick-start).
