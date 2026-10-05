import type { ServerResponse } from "node:http";

export const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self' 'sha256-+q036Nk0nQ7NFjlMFIe0424d4UsgoNfTwSHUlpI62+E='; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function send_text(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

export function send_json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...HEADERS, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function content_disposition(filename: string): string {
  const fallback = filename
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[. ]+$/, "") || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
