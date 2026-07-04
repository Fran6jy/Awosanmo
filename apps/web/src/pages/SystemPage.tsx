import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, Database, HardDrive, MemoryStick, Radio, Server } from "lucide-react";
import { Shell } from "../components/Shell";
import { api, token } from "../lib/api";
import { formatBytes, formatEta } from "../lib/format";

type CountRow = { status?: string; media_kind?: string; probe_status?: string; count: number; size?: number };
type RecentRow = { type: string; title: string; detail: string; timestamp: string };
type Status = {
  app: { uptime: number; node: string; env: string; dataDir: string; torrentPort: number };
  host: { platform: string; arch: string; cpus: number; loadavg: number[]; totalMemory: number; freeMemory: number };
  process: { rss: number; heapUsed: number; heapTotal: number; external: number };
  storage: { used: number; available: number; total: number; dataDir: string };
  torrents: CountRow[];
  files: CountRow[];
  probes: CountRow[];
  recent: RecentRow[];
};

export function SystemPage() {
  if (!token()) return <Navigate to="/login" replace />;
  const status = useQuery({ queryKey: ["admin-status"], queryFn: () => api<Status>("/api/admin/status"), refetchInterval: 5000 });
  const data = status.data;

  return (
    <Shell>
      {!data ? (
        <div className="rounded-2xl p-8 glass">Loading system status...</div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl p-5 glass">
            <p className="font-mono text-sm text-stream">SYSTEM</p>
            <h1 className="mt-1 text-3xl font-bold">Server Control Panel</h1>
            <p className="mt-2 break-all text-sm text-slate-400">{data.app.env} · {data.app.node} · {data.app.dataDir}</p>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Server} label="Uptime" value={formatEta(Math.round(data.app.uptime))} />
            <Metric icon={Cpu} label="CPU Load" value={data.host.loadavg[0].toFixed(2)} detail={`${data.host.cpus} CPU · ${data.host.arch}`} />
            <Metric icon={MemoryStick} label="Process RSS" value={formatBytes(data.process.rss)} detail={`${formatBytes(data.process.heapUsed)} heap`} />
            <Metric icon={HardDrive} label="Disk Used" value={formatBytes(data.storage.used)} detail={`${formatBytes(data.storage.available)} free`} />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <Panel title="Torrents" rows={data.torrents.map((row) => [row.status ?? "unknown", String(row.count)])} />
            <Panel title="Files" rows={data.files.map((row) => [row.media_kind ?? "file", `${row.count} · ${formatBytes(row.size ?? 0)}`])} />
            <Panel title="Media Probes" rows={data.probes.map((row) => [row.probe_status ?? "unknown", String(row.count)])} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
            <div className="rounded-2xl p-5 glass">
              <h2 className="text-xl font-bold">Runtime</h2>
              <div className="mt-4 grid gap-3 text-sm">
                <Runtime label="Platform" value={`${data.host.platform} ${data.host.arch}`} />
                <Runtime label="Torrent Port" value={String(data.app.torrentPort)} />
                <Runtime label="Total RAM" value={formatBytes(data.host.totalMemory)} />
                <Runtime label="Free RAM" value={formatBytes(data.host.freeMemory)} />
                <Runtime label="Disk Total" value={formatBytes(data.storage.total)} />
              </div>
            </div>
            <div className="rounded-2xl p-5 glass">
              <h2 className="text-xl font-bold">Recent Activity</h2>
              <div className="mt-4 max-h-96 overflow-auto">
                {data.recent.map((row, index) => (
                  <div key={`${row.type}-${row.title}-${index}`} className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-line py-3 text-sm">
                    <Activity className="mt-0.5 h-4 w-4 text-stream" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.title}</p>
                      <p className="text-slate-500">{row.type} · {row.detail}</p>
                    </div>
                    <span className="text-slate-500">{new Date(row.timestamp).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Radio; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl p-5 glass">
      <div className="flex items-center justify-between text-slate-300"><span>{label}</span><Icon className="h-5 w-5 text-stream" /></div>
      <p className="mt-4 text-2xl font-bold">{value}</p>
      {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
    </div>
  );
}

function Panel({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-2xl p-5 glass">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-4 space-y-2">
        {rows.length ? rows.map(([label, value]) => (
          <div key={label} className="flex min-h-11 items-center justify-between rounded-xl border border-line bg-white/[.03] px-3 text-sm">
            <span className="capitalize text-slate-300">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        )) : <p className="text-sm text-slate-500">No data yet.</p>}
      </div>
    </div>
  );
}

function Runtime({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between rounded-xl border border-line bg-white/[.03] px-3 py-2"><span className="text-slate-500">{label}</span><span className="font-medium">{value}</span></div>;
}
