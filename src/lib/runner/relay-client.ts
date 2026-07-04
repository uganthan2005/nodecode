// Browser half of the WS relay (TRD §7). Connects as the "browser" peer, keeps
// the socket alive, and surfaces runner presence + inbound file notifications.
// The runner is the peer that actually touches disk and Docker.

export interface RelayHandlers {
  onReady?: (peers: string[]) => void;
  onPeer?: (role: string, connected: boolean) => void;
  /** The runner reported a local edit — the graph should refresh. */
  onRunnerFileChanged?: (filePath: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

export interface RelayConnection {
  /** Tell the runner a browser-side code edit persisted — it should re-pull. */
  invalidate: () => void;
  close: () => void;
}

export function connectBrowserRelay(
  relayUrl: string,
  token: string,
  handlers: RelayHandlers,
): RelayConnection {
  const ws = new WebSocket(relayUrl);
  let closedByUs = false;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "hello", token, role: "browser" }));
  });

  ws.addEventListener("message", (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        handlers.onReady?.((msg.peers as string[]) ?? []);
        break;
      case "peer":
        handlers.onPeer?.(String(msg.role), Boolean(msg.connected));
        break;
      case "fileChanged":
        if (msg.origin === "runner") {
          handlers.onRunnerFileChanged?.(String(msg.filePath ?? ""));
        }
        break;
      case "error":
        handlers.onError?.(String(msg.message ?? "relay error"));
        break;
    }
  });

  ws.addEventListener("close", () => {
    if (!closedByUs) handlers.onClose?.();
  });
  ws.addEventListener("error", () => handlers.onError?.("relay connection error"));

  return {
    invalidate() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "invalidate" }));
      }
    },
    close() {
      closedByUs = true;
      ws.close();
    },
  };
}
