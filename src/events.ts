export type AppEvent =
  | { type: "published"; url: string; itemCount: number }
  | { type: "downloadStarted"; name: string; size: number }
  | { type: "downloadProgress"; name: string; written: number; size: number }
  | { type: "downloadFinished"; name: string }
  | { type: "downloadFailed"; name: string; message: string };
