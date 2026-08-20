import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Downloads } from "./downloads.js";
import type { AppEvent } from "./events.js";
import { sendJson, sendText } from "./http.js";
import { parseSenderMessage, type PublishMessage } from "./protocol.js";
import { createShare, shareDetails, type Share } from "./share.js";
import { SenderConnection } from "./transfer.js";
import { sendAsset, sendPage } from "./view.js";

export interface SenditServerOptions {
  port?: number;
  publicUrl?: string;
  onEvent?: (event: AppEvent) => void;
}

export interface SendItServer {
  port: number;
  adminKey: string;
  adminUrl: string;
  setPublicUrl(url: string): void;
  close(): Promise<void>;
}

export async function startSendItServer(options: SenditServerOptions = {}): Promise<SendItServer> {
  const adminKey = randomBytes(24).toString("base64url");
  const sender = new SenderConnection();
  const downloads = new Downloads(sender, (event) => options.onEvent?.(event));
  const sockets = new WebSocketServer({ noServer: true });
  let share: Share | null = null;
  let publicUrl = options.publicUrl ?? "";

  const server = createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      if (!response.headersSent) sendText(response, 500, message);
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = requestUrl(request);
    if (url.pathname !== "/ws/sender" || url.searchParams.get("key") !== adminKey) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  });

  sockets.on("connection", (socket) => connectSender(socket));

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

  function connectSender(socket: WebSocket): void {
    sender.connect(socket);
    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 30_000);

    const cleanup = () => {
      clearInterval(pingInterval);
      sender.disconnectSocket(socket);
    };

    socket.on("message", (data, binary) => {
      if (binary) {
        sender.handleChunk(Buffer.from(data as Buffer));
        return;
      }
      const message = parseSenderMessage(data.toString());
      if (!message) {
        sender.send({ type: "error", message: "Invalid sender message." });
        return;
      }
      switch (message.type) {
        case "publish":
          publish(message);
          return;
        default:
          sender.handleMessage(message);
      }
    });
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    sender.send({ type: "ready" });
  }

  function publish(message: PublishMessage): void {
    if (!publicUrl) {
      sender.send({ type: "error", message: "The public tunnel is not ready." });
      return;
    }
    try {
      share = createShare(message);
      const url = `${publicUrl}/s/${share.token}`;
      sender.send({ type: "published", url });
      options.onEvent?.({ type: "published", url, itemCount: share.items.length });
    } catch (error) {
      sender.send({ type: "error", message: error instanceof Error ? error.message : "Could not share files." });
    }
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "GET") {
      sendText(response, 405, "Method not allowed.");
      return;
    }
    const url = requestUrl(request);
    const parts = url.pathname.split("/").filter(Boolean);

    if (url.pathname === "/" && url.searchParams.get("key") === adminKey) {
      await sendPage(response, "sender.html");
      return;
    }

    switch (parts[0]) {
      case "health":
        if (parts.length !== 1) break;
        sendJson(response, 200, { status: "ok", senderConnected: sender.isConnected() });
        return;
      case "assets":
        if (parts.length === 2 && await sendAsset(response, parts[1] ?? "")) return;
        break;
      case "api":
        if (parts[1] === "shares" && parts.length === 3) {
          const current = currentShare(parts[2]);
          if (current) sendJson(response, 200, shareDetails(current, sender.isConnected()));
          else sendJson(response, 404, { error: "This share is no longer available." });
          return;
        }
        break;
      case "s":
        await routeShare(response, parts);
        return;
    }
    sendText(response, 404, "Not found.");
  }

  async function routeShare(response: ServerResponse, parts: string[]): Promise<void> {
    const current = currentShare(parts[1]);

    if (parts.length === 2) {
      if (current) await sendPage(response, "receiver.html");
      else sendText(response, 404, "This share is no longer available.");
      return;
    }
    switch (parts[2]) {
      case "files": {
        if (parts.length !== 4) break;
        const item = current?.items.find((candidate) => candidate.id === decodeURIComponent(parts[3] ?? ""));
        if (item) await downloads.file(response, item);
        else sendText(response, 404, "File not found.");
        return;
      }
      case "archive":
        if (parts.length !== 3) break;
        if (current) await downloads.archive(response, current);
        else sendText(response, 404, "This share is no longer available.");
        return;
    }
    sendText(response, 404, "Not found.");
  }

  function currentShare(token: string | undefined): Share | null {
    return token && share?.token === token ? share : null;
  }

  return {
    port,
    adminKey,
    adminUrl: `http://127.0.0.1:${port}/?key=${encodeURIComponent(adminKey)}`,
    setPublicUrl(url: string) {
      publicUrl = url.replace(/\/$/, "");
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

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://localhost");
}
