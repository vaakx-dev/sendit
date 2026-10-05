import type { ServerResponse } from "node:http";

export const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self' 'sha256-+q036Nk0nQ7NFjlMFIe0424d4UsgoNfTwSHUlpI62+E='; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end(body);
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

export function attachment(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
