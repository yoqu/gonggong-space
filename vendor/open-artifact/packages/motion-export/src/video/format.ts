import { getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import type { FilmFacts } from '../frame-source.ts';
import { EXPORT_AUDIO_BITRATE, planVideoFrames } from '../plan.ts';
import type { VideoFramePlan, VideoSettings } from '../plan.ts';
import type { ExportDimensions } from '../types.ts';
import { formatLabels } from '../words.ts';

export type ExportVideoCodec = 'avc' | 'vp9' | 'av1';
export type ExportAudioCodec = 'aac' | 'opus';

/** The codecs a video is made with, and how that is said to people. */
export interface VideoFormat {
  label: string;
  note?: string;
  videoCodec: ExportVideoCodec;
  audioCodec: ExportAudioCodec | null;
}

export interface VideoPlan extends VideoFramePlan {
  format: VideoFormat;
}

const isVideoCodec = (codec: string | null): codec is ExportVideoCodec => codec === 'avc' || codec === 'vp9' || codec === 'av1';
const isAudioCodec = (codec: string | null): codec is ExportAudioCodec => codec === 'aac' || codec === 'opus';

/** The format a pair of codecs makes: H.264 with AAC first, else whatever this browser can encode. */
export function describeVideoFormat(videoCodec: ExportVideoCodec, audioCodec: ExportAudioCodec | null): VideoFormat {
  if (videoCodec === 'avc') {
    if (audioCodec === 'aac') return { label: formatLabels.avcAac, videoCodec, audioCodec };
    if (audioCodec === 'opus') return { label: formatLabels.avcOpus, note: formatLabels.avcOpusNote, videoCodec, audioCodec };
    return { label: formatLabels.avcSilent, note: formatLabels.avcSilentNote, videoCodec, audioCodec: null };
  }
  const audio = audioCodec === 'opus' ? audioCodec : null;
  return { label: formatLabels.other(videoCodec, audio !== null), note: formatLabels.otherNote(audio !== null), videoCodec, audioCodec: audio };
}

/** The best codecs this browser encodes at that size; null when it encodes no video at all. */
export async function chooseExportCodecs(size: ExportDimensions, bitrate: number): Promise<VideoFormat | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: size.width, height: size.height, bitrate });
  if (!isVideoCodec(videoCodec)) return null;
  const audioCodec =
    typeof AudioEncoder === 'undefined'
      ? null
      : await getFirstEncodableAudioCodec(videoCodec === 'avc' ? ['aac', 'opus'] : ['opus'], { numberOfChannels: 2, sampleRate: 48_000, bitrate: EXPORT_AUDIO_BITRATE });
  return describeVideoFormat(videoCodec, isAudioCodec(audioCodec) ? audioCodec : null);
}

export async function planVideoExport(film: FilmFacts, settings: VideoSettings): Promise<VideoPlan | null> {
  const frames = planVideoFrames(film, settings);
  const format = await chooseExportCodecs(frames, frames.videoBitrate);
  return format === null ? null : { ...frames, format };
}
