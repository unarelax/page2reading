import type { TaskRecord, TaskStatus } from "../types.js";

export const INTERRUPTED_MESSAGE = "导出已中断，请重试";

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "succeeded" || status === "succeeded_with_warnings" || status === "failed";
}

/** 终态一旦写下就不再接受更早的进度。返回 null 表示这次写入应丢弃。 */
export function mergeTaskPatch(current: TaskRecord, patch: Partial<TaskRecord>): TaskRecord | null {
  if (isTerminalStatus(current.status)) return null;
  return { ...current, ...patch };
}

export function settleInterrupted(
  tasks: TaskRecord[],
  finishedAt: string,
): { tasks: TaskRecord[]; changed: boolean } {
  let changed = false;
  const next = tasks.map((task) => {
    if (isTerminalStatus(task.status)) return task;
    changed = true;
    return {
      ...task,
      status: "failed" as const,
      error: INTERRUPTED_MESSAGE,
      finishedAt,
      progressNote: null,
    };
  });
  return { tasks: next, changed };
}
