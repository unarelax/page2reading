import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serial.js";
import { INTERRUPTED_MESSAGE, mergeTaskPatch, settleInterrupted } from "./task-status.js";
import type { TaskRecord, TaskStatus } from "../types.js";

function task(status: TaskStatus, id = "t"): TaskRecord {
  return {
    id,
    url: "https://example.com/a",
    normalizedUrl: "https://example.com/a",
    pageTitle: "A",
    mode: "original",
    status,
    error: null,
    warnings: [],
    files: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    finishedAt: null,
    progressNote: "1/2",
  };
}

describe("mergeTaskPatch", () => {
  it("进行中的任务接受进度", () => {
    const merged = mergeTaskPatch(task("translating"), { progressNote: "2/2" });
    expect(merged?.progressNote).toBe("2/2");
    expect(merged?.status).toBe("translating");
  });

  it("终态不再被更早的进度盖回去", () => {
    expect(mergeTaskPatch(task("succeeded"), { status: "translating", progressNote: "1/2" })).toBeNull();
    expect(mergeTaskPatch(task("failed"), { status: "rendering" })).toBeNull();
    expect(mergeTaskPatch(task("succeeded_with_warnings"), { status: "extracting" })).toBeNull();
  });
});

describe("settleInterrupted", () => {
  it("只把非终态收成失败", () => {
    const done = task("succeeded", "done");
    const queued = task("queued", "queued");
    const rendering = task("rendering", "rendering");
    const { tasks, changed } = settleInterrupted([done, queued, rendering], "2026-09-19T01:00:00.000Z");
    expect(changed).toBe(true);
    expect(tasks[0]).toBe(done);
    expect(tasks[1]).toMatchObject({
      status: "failed",
      error: INTERRUPTED_MESSAGE,
      finishedAt: "2026-09-19T01:00:00.000Z",
      progressNote: null,
    });
    expect(tasks[2].status).toBe("failed");
  });

  it("没有进行中的任务时不改列表", () => {
    const tasks = [task("failed")];
    const settled = settleInterrupted(tasks, "2026-09-19T01:00:00.000Z");
    expect(settled.changed).toBe(false);
    expect(settled.tasks[0]).toBe(tasks[0]);
  });
});

describe("createSerialQueue", () => {
  it("同一时刻只有一个任务在跑，失败也不会掐断后面的", async () => {
    const queue = createSerialQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const track = async (value: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value;
    };
    const first = queue(() => track(1));
    const broken = queue(async () => {
      throw new Error("boom");
    });
    const third = queue(() => track(3));
    await expect(first).resolves.toBe(1);
    await expect(broken).rejects.toThrow("boom");
    await expect(third).resolves.toBe(3);
    expect(maxInFlight).toBe(1);
  });

  it("进度写入结束后，完成状态仍能落上", async () => {
    const queue = createSerialQueue();
    let current = task("translating");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const progress = queue(async () => {
      const snap = current;
      await gate;
      const merged = mergeTaskPatch(snap, { progressNote: "2/2" });
      if (merged) current = merged;
    });
    const done = queue(async () => {
      const merged = mergeTaskPatch(current, {
        status: "succeeded",
        finishedAt: "2026-09-19T01:00:00.000Z",
        progressNote: null,
      });
      if (merged) current = merged;
    });
    release();
    await progress;
    await done;
    expect(current.status).toBe("succeeded");
    expect(current.progressNote).toBeNull();
  });
});
