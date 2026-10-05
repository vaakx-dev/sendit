export type AppEvent =
  | { type: "published"; url: string; item_count: number }
  | { type: "download_started"; name: string; size: number }
  | { type: "download_progress"; name: string; written: number; size: number }
  | { type: "download_finished"; name: string }
  | { type: "download_failed"; name: string; message: string };
