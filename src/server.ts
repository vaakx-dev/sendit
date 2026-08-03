import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { Downloads } from "./downloads.js";
import type { AppEvent } from "./events.js";
import { send_json, send_text } from "./http.js";
import { parse_sender_message, type PublishMessage } from "./protocol.js";
import { create_share, share_details, type Share } from "./share.js";
import { SenderConnection } from "./transfer.js";
import { send_asset, send_page } from "./view.js";

export interface SenditServerOptions {
  port?: number;
  public_url?: string;
  on_event?: (event: AppEvent) => void;
}

export interface SenditServer {
  port: number;
  admin_key: string;
  admin_url: string;
  set_public_url(url: string): void;
  close(): Promise<void>;
}

export async function start_sendit_server(options: SenditServerOptions = {}): Promise<SenditServer> {
  const admin_key = randomBytes(24).toString("base64url");
  const sender = new SenderConnection();
  const downloads = new Downloads(sender, (event) => options.on_event?.(event));
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  let share: Share | null = null;
  let public_url = options.public_url ?? "";

  const server = createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      if (!response.headersSent) send_text(response, 500, message);
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = request_url(request);
    if (url.pathname !== "/ws/sender" || url.searchParams.get("key") !== admin_key) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  });

  sockets.on("connection", (socket) => connect_sender(socket));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine local port.");
  const port = address.port;

  function connect_sender(socket: WebSocket): void {
    sender.connect(socket);
    socket.on("message", (data, binary) => {
      if (binary) {
        sender.handle_chunk(Buffer.from(data as Buffer));
        return;
      }
      const message = parse_sender_message(data.toString());
      if (!message) {
        sender.send({ type: "error", message: "Invalid sender message." });
        return;
      }
      switch (message.type) {
        case "publish":
          publish(message);
          return;
        default:
          sender.handle_message(message);
      }
    });
    socket.on("close", () => sender.disconnect_socket(socket));
    socket.on("error", () => sender.disconnect_socket(socket));
    sender.send({ type: "ready" });
  }

  function publish(message: PublishMessage): void {
    if (!public_url) {
      sender.send({ type: "error", message: "The public tunnel is not ready." });
      return;
    }
    try {
      share = create_share(message);
      const url = `${public_url}/s/${share.token}`;
      sender.send({ type: "published", url });
      options.on_event?.({ type: "published", url, item_count: share.items.length });
    } catch (error) {
      sender.send({ type: "error", message: error instanceof Error ? error.message : "Could not share files." });
    }
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "GET") {
      send_text(response, 405, "Method not allowed.");
      return;
    }
    const url = request_url(request);
    const parts = url.pathname.split("/").filter(Boolean);

    if (url.pathname === "/" && url.searchParams.get("key") === admin_key) {
      await send_page(response, "sender.html");
      return;
    }

    switch (parts[0]) {
      case "health":
        if (parts.length !== 1) break;
        send_json(response, 200, { status: "ok", sender_connected: sender.is_connected() });
        return;
      case "assets":
        if (parts.length === 2 && await send_asset(response, parts[1] ?? "")) return;
        break;
      case "api":
        if (parts[1] === "shares" && parts.length === 3) {
          const current = current_share(parts[2]);
          if (current) send_json(response, 200, share_details(current, sender.is_connected()));
          else send_json(response, 404, { error: "This share is no longer available." });
          return;
        }
        break;
      case "s":
        await route_share(response, parts);
        return;
    }
    send_text(response, 404, "Not found.");
  }

  async function route_share(response: ServerResponse, parts: string[]): Promise<void> {
    const current = current_share(parts[1]);

    if (parts.length === 2) {
      if (current) await send_page(response, "receiver.html");
      else send_text(response, 404, "This share is no longer available.");
      return;
    }
    switch (parts[2]) {
      case "files": {
        if (parts.length !== 4) break;
        const item = current?.items.find((candidate) => candidate.id === decodeURIComponent(parts[3] ?? ""));
        if (item) await downloads.file(response, item);
        else send_text(response, 404, "File not found.");
        return;
      }
      case "archive":
        if (parts.length !== 3) break;
        if (current) await downloads.archive(response, current);
        else send_text(response, 404, "This share is no longer available.");
        return;
    }
    send_text(response, 404, "Not found.");
  }

  function current_share(token: string | undefined): Share | null {
    return token && share?.token === token ? share : null;
  }

  return {
    port,
    admin_key,
    admin_url: `http://127.0.0.1:${port}/?key=${encodeURIComponent(admin_key)}`,
    set_public_url(url: string) {
      public_url = url.replace(/\/$/, "");
    },
    async close() {
      sender.disconnect(new Error("SendIt stopped."));
      sockets.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function request_url(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://localhost");
}
