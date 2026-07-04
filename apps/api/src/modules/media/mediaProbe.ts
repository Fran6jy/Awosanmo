import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../../config.js";

const execFileAsync = promisify(execFile);

export type MediaProbeResult = {
  duration: number | null;
  bitrate: number | null;
  width: number | null;
  height: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  frameRate: number | null;
  audioTracks: number;
  subtitleTracks: number;
};

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ], {
    timeout: config.mediaProbeTimeoutSeconds * 1000,
    maxBuffer: 512 * 1024,
    windowsHide: true
  });
  const payload = JSON.parse(stdout);
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const video = streams.find((stream: any) => stream.codec_type === "video");
  const audio = streams.find((stream: any) => stream.codec_type === "audio");
  const audioTracks = streams.filter((stream: any) => stream.codec_type === "audio").length;
  const subtitleTracks = streams.filter((stream: any) => stream.codec_type === "subtitle").length;
  return {
    duration: numberOrNull(payload.format?.duration ?? video?.duration),
    bitrate: integerOrNull(payload.format?.bit_rate ?? video?.bit_rate),
    width: integerOrNull(video?.width),
    height: integerOrNull(video?.height),
    codecVideo: video?.codec_name ?? null,
    codecAudio: audio?.codec_name ?? null,
    frameRate: parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    audioTracks,
    subtitleTracks
  };
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value: unknown) {
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? number : null;
}

function parseFrameRate(value: unknown) {
  if (!value || value === "0/0") return null;
  const [numerator, denominator] = String(value).split("/").map(Number);
  if (!denominator) return Number.isFinite(numerator) ? numerator : null;
  return numerator / denominator;
}
