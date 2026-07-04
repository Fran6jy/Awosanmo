import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Captions, CheckCircle2, Film, Gauge, HardDrive, Pause, Play, Radio, RefreshCw, Trash2, Users, Volume2 } from "lucide-react";
import { Shell } from "../components/Shell";
import { api, token } from "../lib/api";
import { formatBytes, formatDuration, formatEta } from "../lib/format";

type TorrentFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  media_kind: string;
  streamable: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  codec_video?: string | null;
  codec_audio?: string | null;
  audio_tracks?: number;
  subtitle_tracks?: number;
  probe_status?: string;
};
type Peer = { address: string; port: number | null; downloaded: number; uploaded: number; downloadSpeed: number; uploadSpeed: number; choked: boolean };
type Tracker = { url: string; status: string };
type Detail = {
  id: string;
  name: string;
  info_hash?: string;
  status: string;
  progress: number;
  download_speed: number;
  upload_speed: number;
  downloaded: number;
  uploaded: number;
  size: number;
  files: TorrentFile[];
  runtime: {
    active: boolean;
    peers: number;
    ratio: number;
    etaSeconds: number | null;
    health: string;
    pieces: { total: number; complete: number; map: boolean[] };
    trackers: Tracker[];
    peerList: Peer[];
  };
};

export function TorrentDetail() {
  if (!token()) return <Navigate to="/login" replace />;
  const { id } = useParams();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["torrent", id], queryFn: () => api<Detail>(`/api/torrents/${id}`), enabled: Boolean(id), refetchInterval: 1800 });
  const action = useMutation({
    mutationFn: (kind: "pause" | "resume" | "reannounce" | "recheck" | "delete") => {
      if (kind === "delete") return api(`/api/torrents/${id}?destroy=false`, { method: "DELETE" });
      return api(`/api/torrents/${id}/${kind}`, { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["torrent", id] });
      qc.invalidateQueries({ queryKey: ["torrents"] });
    }
  });
  const probe = useMutation({
    mutationFn: (fileId: string) => api(`/api/torrents/files/${fileId}/probe`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["torrent", id] })
  });
  const torrent = detail.data;

  return (
    <Shell>
      <Link to="/" className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>
      {!torrent ? (
        <div className="rounded-2xl p-8 glass">Loading torrent...</div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl p-5 glass">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-sm uppercase text-stream">{torrent.runtime.health} health · {torrent.status}</p>
                <h1 className="mt-2 truncate text-3xl font-bold">{torrent.name}</h1>
                <p className="mt-2 break-all text-sm text-slate-400">{torrent.info_hash ?? "Waiting for metadata"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => action.mutate(torrent.status === "paused" ? "resume" : "pause")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-stream px-4 font-bold text-ink transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-white">
                  {torrent.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {torrent.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button onClick={() => action.mutate("reannounce")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream"><RefreshCw className="h-4 w-4" /> Reannounce</button>
                <button onClick={() => action.mutate("recheck")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream"><CheckCircle2 className="h-4 w-4" /> Recheck</button>
                <button onClick={() => action.mutate("delete")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-400/30 px-4 text-red-200 transition hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-300"><Trash2 className="h-4 w-4" /> Delete</button>
              </div>
            </div>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-stream" style={{ width: `${Math.round(torrent.progress * 100)}%` }} /></div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["Progress", `${Math.round(torrent.progress * 100)}%`, Gauge],
              ["Peers", String(torrent.runtime.peers), Users],
              ["ETA", formatEta(torrent.runtime.etaSeconds), Radio],
              ["Size", formatBytes(torrent.size), HardDrive]
            ].map(([label, value, Icon]) => (
              <div key={String(label)} className="rounded-2xl p-5 glass">
                <div className="flex items-center justify-between text-slate-300"><span>{label as string}</span><Icon className="h-5 w-5 text-stream" /></div>
                <p className="mt-4 text-2xl font-bold">{value as string}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
            <div className="rounded-2xl p-5 glass">
              <h2 className="text-xl font-bold">Files</h2>
              <div className="mt-4 space-y-2">
                {torrent.files.map((file) => (
                  <div key={file.id} className="rounded-xl border border-line bg-white/[.03] p-3">
                    <div className="flex min-h-11 items-center gap-3">
                      <Film className={file.media_kind === "video" ? "h-5 w-5 text-stream" : "h-5 w-5 text-slate-400"} />
                      <Link to={file.streamable ? `/watch/${file.id}` : "#"} className="min-w-0 flex-1 truncate transition hover:text-stream">{file.path}</Link>
                      <span className="text-sm text-slate-400">{formatBytes(file.size)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 pl-8 text-xs text-slate-300">
                      <Badge value={file.probe_status ?? "pending"} />
                      <Badge value={file.width && file.height ? `${file.width}x${file.height}` : null} />
                      <Badge value={formatDuration(file.duration)} />
                      <Badge value={file.codec_video ? file.codec_video.toUpperCase() : null} />
                      <Badge value={file.codec_audio ? file.codec_audio.toUpperCase() : null} />
                      {(file.audio_tracks ?? 0) > 0 && <Badge value={`${file.audio_tracks} audio`} icon="audio" />}
                      {(file.subtitle_tracks ?? 0) > 0 && <Badge value={`${file.subtitle_tracks} subs`} icon="subs" />}
                      {file.streamable ? <button onClick={() => probe.mutate(file.id)} className="rounded-full border border-line px-3 py-1 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream">Probe</button> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl p-5 glass">
                <h2 className="text-xl font-bold">Piece Map</h2>
                <p className="mt-1 text-sm text-slate-400">{torrent.runtime.pieces.complete} / {torrent.runtime.pieces.total || "unknown"} pieces verified</p>
                <div className="mt-4 grid grid-cols-24 gap-1">
                  {(torrent.runtime.pieces.map.length ? torrent.runtime.pieces.map : Array.from({ length: 96 }, () => false)).map((done, index) => (
                    <div key={index} className={`h-2 rounded-sm ${done ? "bg-stream" : "bg-white/10"}`} />
                  ))}
                </div>
              </div>
              <div className="rounded-2xl p-5 glass">
                <h2 className="text-xl font-bold">Transfer</h2>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Down" value={`${formatBytes(torrent.download_speed)}/s`} />
                  <Metric label="Up" value={`${formatBytes(torrent.upload_speed)}/s`} />
                  <Metric label="Downloaded" value={formatBytes(torrent.downloaded)} />
                  <Metric label="Uploaded" value={formatBytes(torrent.uploaded)} />
                  <Metric label="Ratio" value={torrent.runtime.ratio.toFixed(2)} />
                  <Metric label="Runtime" value={torrent.runtime.active ? "Active" : "Offline"} />
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl p-5 glass">
              <h2 className="text-xl font-bold">Peers</h2>
              <div className="mt-4 max-h-80 overflow-auto">
                {torrent.runtime.peerList.length ? torrent.runtime.peerList.map((peer, index) => (
                  <div key={`${peer.address}-${peer.port}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-line py-3 text-sm">
                    <span className="truncate text-slate-200">{peer.address}:{peer.port ?? "-"}</span>
                    <span className="text-slate-400">{formatBytes(peer.downloadSpeed)}/s</span>
                  </div>
                )) : <p className="text-sm text-slate-400">No peers reported yet.</p>}
              </div>
            </div>
            <div className="rounded-2xl p-5 glass">
              <h2 className="text-xl font-bold">Trackers</h2>
              <div className="mt-4 max-h-80 overflow-auto">
                {torrent.runtime.trackers.length ? torrent.runtime.trackers.map((tracker) => (
                  <div key={tracker.url} className="border-b border-line py-3 text-sm">
                    <p className="truncate text-slate-200">{tracker.url}</p>
                    <p className="text-slate-500">{tracker.status}</p>
                  </div>
                )) : <p className="text-sm text-slate-400">Trackers appear after metadata is available.</p>}
              </div>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-line bg-white/[.03] p-3"><p className="text-slate-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function Badge({ value, icon }: { value?: string | null; icon?: "audio" | "subs" }) {
  if (!value) return null;
  return (
    <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-line bg-white/[.04] px-3 py-1">
      {icon === "audio" ? <Volume2 className="h-3.5 w-3.5" /> : null}
      {icon === "subs" ? <Captions className="h-3.5 w-3.5" /> : null}
      {value}
    </span>
  );
}
