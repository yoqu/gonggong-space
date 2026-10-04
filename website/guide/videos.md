<script setup>
import { withBase } from 'vitepress'
</script>

# 视频介绍

两支视频，一支看个大概，一支跟着走一遍主要功能。

## 产品宣传片（60 秒）

<video controls preload="metadata" width="100%" :poster="withBase('/videos/promo.jpg')" :src="withBase('/videos/promo.mp4')"></video>

## 功能讲解：新同事入职 · 八关通关（3 分 56 秒）

<video controls preload="metadata" width="100%" :poster="withBase('/videos/explainer.jpg')" :src="withBase('/videos/explainer.mp4')"></video>

看完可以接着读 [快速上手](/guide/quick-start)。
