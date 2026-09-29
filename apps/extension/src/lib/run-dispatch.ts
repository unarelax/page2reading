export interface Postable {
  postMessage(message: unknown): void;
}

export type FlushResult = "sent" | "waiting" | "idle";

export interface RunDispatch<T> {
  readonly port: Postable | null;
  readonly pending: T | null;
  setPort(port: Postable | null): void;
  /** closeDocument 已 resolve 时调用。此时 onDisconnect 可能还没到，不能再往旧 port 投。 */
  invalidatePort(): void;
  deliver(message: T): "sent" | "waiting";
  flush(): FlushResult;
  clearPendingIf(pred: (message: T) => boolean): void;
}

export function createRunDispatch<T>(): RunDispatch<T> {
  let port: Postable | null = null;
  let pending: T | null = null;

  function flush(): FlushResult {
    if (!pending) return "idle";
    if (!port) return "waiting";
    const target = port;
    const message = pending;
    try {
      target.postMessage(message);
    } catch (err) {
      if (port === target) port = null;
      throw err;
    }
    pending = null;
    return "sent";
  }

  return {
    get port() {
      return port;
    },
    get pending() {
      return pending;
    },
    setPort(next) {
      port = next;
    },
    invalidatePort() {
      port = null;
    },
    deliver(message) {
      pending = message;
      const result = flush();
      return result === "idle" ? "waiting" : result;
    },
    flush,
    clearPendingIf(pred) {
      if (pending && pred(pending)) pending = null;
    },
  };
}
