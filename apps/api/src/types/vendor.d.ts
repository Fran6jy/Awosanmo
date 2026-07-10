declare module "better-sqlite3" {
  export default class Database {
    constructor(path: string);
    pragma(sql: string): unknown;
    exec(sql: string): unknown;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
  }
}

declare module "multer" {
  const multer: any;
  export default multer;
}

declare module "archiver" {
  const archiver: any;
  export default archiver;
}

declare module "webtorrent" {
  export type TorrentFile = {
    name: string;
    path: string;
    length: number;
    select(): void;
  };
  export type Torrent = {
    infoHash: string;
    name: string;
    length: number;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    downloaded: number;
    uploaded: number;
    numPeers?: number;
    timeRemaining?: number;
    ratio?: number;
    files: TorrentFile[];
    on(event: string, handler: (...args: any[]) => void): void;
    pause(): void;
    resume(): void;
  };
  export default class WebTorrent {
    torrents: Torrent[];
    constructor(options?: Record<string, unknown>);
    add(magnetUri: string, options?: Record<string, unknown>): Torrent;
    remove(infoHash: string, options?: Record<string, unknown>): void;
    on(event: string, handler: (...args: any[]) => void): void;
  }
}
