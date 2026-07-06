import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, Image as ImageIcon, Loader2, Music, Video } from "lucide-react";
import { API_URL, api, token } from "../lib/api";
import { formatBytes } from "../lib/format";
import { previewKind } from "../lib/fileTypes";
import { ThemeToggle } from "../components/ThemeToggle";

type FileRow = {
  id: string; name: string; path: string; size: number; mime?: string | null; media_kind: string; streamable: number;
  duration?: number | null; width?: number | null; height?: number | null;
  codec_video?: string | null; codec_audio?: string | null; probe_status?: string | null;
};
type Playback = { positionSeconds: number; updatedAt: string | null; subtitles: { id: string; name: string; path: string }[] };

export function FileViewer() {
  const authed = !!token();
  const { id } = useParams();
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [forceTranscode, setForceTranscode] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const file = useQuery({ queryKey: ["file", id], queryFn: () => api<FileRow>(`/api/files/${id}`), enabled: Boolean(id) && authed });
  const stream = useQuery({
    queryKey: ["stream-token", id],
    queryFn: () => api<{ streamToken: string; expiresIn: number }>(`/api/stream-token/${id}`, { method: "POST" }),
    enabled: Boolean(id) && authed,
    staleTime: 45 * 60 * 1000
  });
  const playback = useQuery({
    queryKey: ["playback", id],
    queryFn: () => api<Playback>(`/api/playback/${id}`),
    enabled: Boolean(id) && authed && previewKind(file.data ?? { name: "" }) === "video"
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
  const kind = previewKind(file.data ?? { name: "" });
  const meta = file.data;
  const shouldTranscode = Boolean(meta && kind === "video" && (forceTranscode || needsTranscode(meta)));
  const videoSrc = stream.data && shouldTranscode ? `${API_URL}/api/transcode/${id}?st=${encodeURIComponent(stream.data.streamToken)}` : src;
  const tracks = useMemo(() => {
    return (playback.data?.subtitles ?? []).map((subtitle, index) => {
      const subtitleToken = subtitleTokens[index]?.data?.subtitleToken;
      return subtitleToken ? { ...subtitle, src: `${API_URL}/api/subtitle/${subtitle.id}?tt=${encodeURIComponent(subtitleToken)}` } : null;
    }).filter(Boolean) as { id: string; name: string; src: string }[];
  }, [playback.data?.subtitles, subtitleTokens]);

  useEffect(() => {
    if (kind !== "text" || !src) return;
    let active = true;
    fetch(src).then((res) => res.text()).then((body) => {
      if (active) setText(body.slice(0, 500_000));
    }).catch(() => {
      if (active) setText("Could not load text preview.");
    });
    return () => { active = false; };
  }, [kind, src]);

  useEffect(() => {
    const video = mediaRef.current;
    const position = playback.data?.positionSeconds ?? 0;
    if (!video || !position || kind !== "video") return;
    const apply = () => {
      if (position > 5 && Math.abs(video.currentTime - position) > 5) video.currentTime = position;
    };
    video.addEventListener("loadedmetadata", apply, { once: true });
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [kind, playback.data?.positionSeconds, videoSrc]);

  useEffect(() => {
    const video = mediaRef.current;
    if (!video || !id || kind !== "video") return;
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
  }, [id, kind, savePosition]);

  useEffect(() => {
    setForceTranscode(false);
    setVideoReady(false);
  }, [id]);

  async function download() {
    const { downloadToken } = await api<{ downloadToken: string }>(`/api/download-token/${id}`, { method: "POST" });
    window.location.href = `${API_URL}/api/download/${id}?dt=${encodeURIComponent(downloadToken)}`;
  }

  if (!authed) return <Navigate to="/login" replace />;

  return (
    <main className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-20 border-b border-line bg-[color:var(--app-bg)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/files" className="btn-ghost px-3">
            <ArrowLeft className="h-4 w-4" /> Files
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{meta?.name ?? "Opening file"}</p>
            <p className="text-xs text-slate-400">{meta ? `${kind.toUpperCase()} · ${formatBytes(meta.size)}` : "Preparing secure preview"}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <button onClick={() => void download()} className="btn-primary">
              <Download className="h-4 w-4" /> Download
            </button>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="glass min-h-[72vh] overflow-hidden rounded-2xl">
          {!src || !meta ? <Empty icon={FileText} title="Preparing preview" detail="Creating a short-lived private media link." /> : null}
          {src && meta && kind === "video" ? (
            <div className="relative bg-black p-3">
              <video
                key={shouldTranscode ? "transcode" : "native"}
                ref={mediaRef}
                className="h-[72vh] w-full rounded-xl bg-black"
                controls
                preload="metadata"
                playsInline
                src={videoSrc}
                onLoadStart={() => setVideoReady(false)}
                onPlaying={() => setVideoReady(true)}
                onCanPlay={() => setVideoReady(true)}
                onError={() => {
                  if (!shouldTranscode) setForceTranscode(true);
                }}
              >
                {tracks.map((track, index) => <track key={track.id} kind="subtitles" label={track.name} src={track.src} default={index === 0} />)}
              </video>
              {/* Loading overlay while the (possibly transcoded) stream warms up. */}
              {!videoReady ? (
                <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl bg-black/60 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-accent2" />
                    <p className="text-sm font-medium text-white">Preparing video…</p>
                    <p className="max-w-xs text-xs text-slate-400">Optimizing this file for smooth playback in your browser.</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {src && meta && kind === "audio" ? <Empty icon={Music} title={meta.name} detail="Audio preview"><audio className="mt-6 w-full max-w-2xl" controls src={src} /></Empty> : null}
          {src && meta && kind === "image" ? (
            <div className="grid min-h-[72vh] place-items-center bg-black/20 p-4 md:p-8">
              <img src={src} alt={meta.name} className="max-h-[78vh] max-w-full rounded-xl object-contain shadow-2xl shadow-black/30 ring-1 ring-white/10" />
            </div>
          ) : null}
          {src && meta && kind === "pdf" ? <iframe title={meta.name} src={src} className="h-[78vh] w-full border-0 bg-white" /> : null}
          {src && meta && kind === "text" ? <pre className="max-h-[78vh] overflow-auto whitespace-pre-wrap p-6 font-mono text-sm leading-6 text-slate-100">{text ?? "Loading text preview..."}</pre> : null}
          {src && meta && kind === "epub" ? (
            <EpubReader src={src} title={meta.name} />
          ) : null}
          {src && meta && kind === "file" ? <Empty icon={FileText} title="Preview unavailable" detail="This file type can be downloaded from your library." /> : null}
        </div>
      </section>
    </main>
  );
}

function EpubReader({ src, title }: { src: string; title: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    setReady(false);
    setError("");
    async function open() {
      try {
        const { default: epub } = await import("epubjs");
        if (!hostRef.current || disposed) return;
        hostRef.current.replaceChildren();
        const book = epub(src, { openAs: "epub" });
        const rendition = book.renderTo(hostRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "auto",
          manager: "default"
        });
        bookRef.current = book;
        renditionRef.current = rendition;
        await rendition.display();
        if (!disposed) setReady(true);
      } catch (e) {
        if (!disposed) setError((e as Error).message || "Could not open EPUB.");
      }
    }
    void open();
    return () => {
      disposed = true;
      renditionRef.current?.destroy?.();
      bookRef.current?.destroy?.();
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [src]);

  function prev() {
    renditionRef.current?.prev?.();
  }

  function next() {
    renditionRef.current?.next?.();
  }

  return (
    <div className="flex h-[78vh] flex-col bg-[color:var(--app-panel)]">
      <div className="flex items-center justify-between border-b border-line bg-white/[0.04] px-4 py-3">
        <p className="truncate text-sm font-semibold text-slate-200">{title}</p>
        <div className="flex gap-2">
          <button onClick={prev} className="btn-ghost min-h-10">Previous</button>
          <button onClick={next} className="btn-primary min-h-10">Next</button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {!ready && !error ? <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">Opening EPUB...</div> : null}
        {error ? <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">{error}</div> : null}
        <div ref={hostRef} className="h-full w-full bg-white px-4 py-5 text-slate-950 md:px-10" />
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, detail, children }: { icon: typeof Video | typeof ImageIcon | typeof Music | typeof FileText; title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-[72vh] place-items-center p-6 text-center">
      <div>
        <Icon className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{detail}</p>
        {children}
      </div>
    </div>
  );
}

function needsTranscode(file: FileRow) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const codec = file.codec_video?.toLowerCase();
  return ["mkv", "avi", "flv", "wmv", "mpeg", "mpg"].includes(ext ?? "") || codec === "hevc" || codec === "h265";
}
