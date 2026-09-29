/** 把异步读写串成一条链。前一个失败不会掐断后面的任务。 */
export function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
