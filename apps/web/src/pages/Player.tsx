import { useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { API_URL, api } from "../lib/api";

type Playback = {
  positionSeconds: number;
  updatedAt: string | null;
  subtitles: { id: string; name: string; path: string }[];
};

export function Player() {
  const { id } = useParams();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stream = useQuery({
    queryKey: ["stream-token", id],
    queryFn: () => api<{ streamToken: string; expiresIn: number }>(`/api/stream-token/${id}`, { method: "POST" }),
    enabled: Boolean(id),
    staleTime: 45 * 60 * 1000
  });
  const playback = useQuery({
    queryKey: ["playback", id],
    queryFn: () => api<Playback>(`/api/playback/${id}`),
    enabled: Boolean(id)
  });
  const subtitleTokens = useQueries({
    queries: (playback.data?.subtitles ?? []).map((subtitle) => ({
      queryKey: ["subtitle-token", subtitle.id],
      queryFn: () => api<{ subtitleToken: string; expiresIn: number }>(`/api/subtitle-token/${subtitle.id}`, { method: "POST" }),
      staleTime: 45 * 60 * 1000
    }))
  });
  const savePosition = useMutation({
    mutationFn: (positionSeconds: number) => api(`/api/playback/${id}`, { method: "PUT", body: JSON.stringify({ positionSeconds }) })
  });
  const src = stream.data ? `${API_URL}/api/stream/${id}?st=${encodeURIComponent(stream.data.streamToken)}` : undefined;
  const tracks = useMemo(() => {
    return (playback.data?.subtitles ?? []).map((subtitle, index) => {
      const token = subtitleTokens[index]?.data?.subtitleToken;
      return token ? { ...subtitle, src: `${API_URL}/api/subtitle/${subtitle.id}?tt=${encodeURIComponent(token)}` } : null;
    }).filter(Boolean) as { id: string; name: string; src: string }[];
  }, [playback.data?.subtitles, subtitleTokens]);

  useEffect(() => {
    const video = videoRef.current;
    const position = playback.data?.positionSeconds ?? 0;
    if (!video || !position) return;
    const apply = () => {
      if (position > 5 && Math.abs(video.currentTime - position) > 5) video.currentTime = position;
    };
    video.addEventListener("loadedmetadata", apply, { once: true });
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [playback.data?.positionSeconds, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !id) return;
    const timer = window.setInterval(() => {
      if (!video.paused && video.currentTime > 0) savePosition.mutate(video.currentTime);
    }, 10000);
    const onPause = () => {
      if (video.currentTime > 0) savePosition.mutate(video.currentTime);
    };
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
    };
  }, [id, savePosition]);

  return (
    <main className="min-h-screen bg-black">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-4">
        {src ? (
          <div className="w-full">
            <video ref={videoRef} className="video-js vjs-big-play-centered h-auto w-full overflow-hidden rounded-2xl" controls preload="metadata" playsInline src={src}>
              {tracks.map((track, index) => (
                <track key={track.id} kind="subtitles" label={track.name} src={track.src} default={index === 0} />
              ))}
            </video>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
              <span>{playback.data?.positionSeconds ? `Resuming near ${Math.round(playback.data.positionSeconds)}s` : "Fresh playback"}</span>
              <span>{tracks.length ? `${tracks.length} subtitle track${tracks.length === 1 ? "" : "s"}` : "No subtitles detected"}</span>
            </div>
          </div>
        ) : (
          <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-slate-300">Preparing secure stream...</div>
        )}
      </div>
    </main>
  );
}
