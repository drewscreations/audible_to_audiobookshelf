// ── ABS Types ──

export interface ABSUser {
  id: string;
  username: string;
  type: string;
  isActive: boolean;
  itemsInProgress?: ABSMediaProgress[];
}

export interface ABSLibrary {
  id: string;
  name: string;
  mediaType: string;
  folders: { id: string; fullPath: string }[];
  stats?: {
    totalItems: number;
    totalSize: number;
  };
}

export interface ABSLibraryItem {
  id: string;
  ino: string;
  libraryId: string;
  media: {
    metadata: {
      title: string;
      subtitle?: string;
      authorName?: string;
      narratorName?: string;
      asin?: string;
      isbn?: string;
      duration?: number;
      publishedYear?: string;
      genres?: string[];
      series?: { id: string; name: string; sequence?: string }[];
    };
    coverPath?: string;
    numTracks?: number;
    numAudioFiles?: number;
    numChapters?: number;
    duration?: number;
  };
  addedAt: number;
  updatedAt: number;
}

export interface ABSMediaProgress {
  id: string;
  libraryItemId: string;
  duration: number;
  currentTime: number;
  progress: number;
  isFinished: boolean;
  startedAt?: number;
  finishedAt?: number;
  lastUpdate: number;
}

// ── Libation Types ──

export interface LibationBook {
  asin: string;
  title: string;
  authors: string;
  narrators: string;
  seriesName?: string;
  seriesOrder?: string;
  purchaseDate?: string;
  lengthInMinutes?: number;
  isDownloaded: boolean;
  dateAdded?: string;
  locale?: string;
  coverUrl?: string;
}

export type BookStatus = "in_abs" | "downloaded" | "not_downloaded" | "downloading";

export interface EnrichedBook extends LibationBook {
  status: BookStatus;
  absItem?: ABSLibraryItem;
}

// ── Audible Import Types ──

export interface AudibleAggregateDay {
  asin: string;
  date: string;
  title: string;
  totalListenSeconds: number;
  minStartPosMs: number;
  maxEndPosMs: number;
  firstListenDate: string;
  lastListenDate: string;
}

export interface SyncSession {
  id: string;
  userId: string;
  libraryId: string;
  libraryItemId: string;
  mediaType: "book";
  mediaMetadata: {
    title: string;
    authorName?: string;
  };
  displayTitle: string;
  displayAuthor: string;
  coverPath: string;
  duration: number;
  playMethod: 3;
  mediaPlayer: "AudibleImport";
  deviceInfo: {
    ipAddress: string;
    browserName: string;
    osName: string;
    clientVersion: string;
  };
  date: string;
  dayOfWeek: string;
  timeListening: number;
  startTime: number;
  currentTime: number;
  startedAt: number;
  updatedAt: number;
}

export interface ProgressUpdate {
  libraryItemId: string;
  episodeId: null;
  duration: number;
  currentTime: number;
  progress: number;
  isFinished: boolean;
  startedAt: number;
  finishedAt: number | null;
}

export interface ImportReport {
  id: string;
  timestamp: string;
  user: string;
  audible: {
    rowsAggregated: number;
    uniqueAsins: number;
    dateRange: { first: string; last: string };
  };
  matching: {
    matchedDayRows: number;
    unmatchedDayRows: number;
    matchedAsins: number;
    unmatchedAsins: number;
  };
  sync: {
    sessionsCreated: number;
    sessionsFailed: number;
    progressUpdated: number;
    progressFailed: number;
  };
  unmatchedAsinSample: string[];
}

// ── Config Types ──

export interface AppConfig {
  absUrl: string;
  tokens: Record<string, string>; // e.g., { drew: "eyJ...", mo: "eyJ...", root: "eyJ..." }
  activeUser: string;
  libraries: string[]; // selected library IDs
  libationPath?: string;
  audibleSince?: string;
  batchSize: number;
  finishThreshold: number;
}

// ── API Response Types ──

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface LibationStatus {
  running: boolean;
  portainerAvailable: boolean;
  lastScan?: string;
  bookCount?: number;
  downloadedCount?: number;
}
