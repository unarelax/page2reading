import { describe, expect, it } from "vitest";
import { createRunDispatch } from "./run-dispatch.js";

function port() {
  const messages: unknown[] = [];
  return {
    messages,
    postMessage(message: unknown) {
      messages.push(message);
    },
  };
}

describe("createRunDispatch", () => {
  it("closeDocument 之后不把 run 投给尚未断开的旧 port", () => {
    const dispatch = createRunDispatch<{ taskId: string }>();
    const stale = port();
    const next = port();
    dispatch.setPort(stale);
    dispatch.invalidatePort();

    expect(dispatch.deliver({ taskId: "b" })).toBe("waiting");
    expect(stale.messages).toEqual([]);

    dispatch.setPort(next);
    expect(dispatch.flush()).toBe("sent");
    expect(next.messages).toEqual([{ taskId: "b" }]);

    if (dispatch.port === stale) dispatch.invalidatePort();
    expect(dispatch.port).toBe(next);
  });

  it("onConnect 先到时，随后的 deliver 直接发给新 port", () => {
    const dispatch = createRunDispatch<{ taskId: string }>();
    const next = port();
    dispatch.invalidatePort();
    dispatch.setPort(next);
    expect(dispatch.flush()).toBe("idle");
    expect(dispatch.deliver({ taskId: "b" })).toBe("sent");
    expect(next.messages).toEqual([{ taskId: "b" }]);
  });

  it("postMessage 抛错时留下 pending，并丢掉这个 port", () => {
    const dispatch = createRunDispatch<{ taskId: string }>();
    const dead = {
      postMessage() {
        throw new Error("Attempting to use a disconnected port object");
      },
    };
    dispatch.setPort(dead);
    expect(() => dispatch.deliver({ taskId: "b" })).toThrow(/disconnected port/);
    expect(dispatch.pending).toEqual({ taskId: "b" });
    expect(dispatch.port).toBeNull();
  });

  it("clearPendingIf 只清掉匹配的那次投递", () => {
    const dispatch = createRunDispatch<{ taskId: string }>();
    dispatch.deliver({ taskId: "b" });
    dispatch.clearPendingIf((m) => m.taskId === "other");
    expect(dispatch.pending).toEqual({ taskId: "b" });
    dispatch.clearPendingIf((m) => m.taskId === "b");
    expect(dispatch.pending).toBeNull();
  });
});
