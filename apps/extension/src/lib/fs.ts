// File System Access API：把目录句柄持久化到 IndexedDB，写文件到用户所选根目录。

const DB_NAME = "p2r";
const DB_VERSION = 1;
const STORE = "kv";
const DIR_HANDLE_KEY = "rootDirHandle";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbPut(DIR_HANDLE_KEY, handle);
}

export async function getDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const h = await idbGet(DIR_HANDLE_KEY);
  return (h as FileSystemDirectoryHandle) ?? null;
}

export interface DirStatus {
  configured: boolean;
  name: string | null;
  permission: PermissionState | null;
}

export async function getDirStatus(): Promise<DirStatus> {
  const handle = await getDirHandle();
  if (!handle) return { configured: false, name: null, permission: null };
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return { configured: true, name: handle.name, permission };
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const state = await handle.queryPermission({ mode: "readwrite" });
  if (state === "granted") return;
  if (state === "prompt") throw new Error("保存目录权限已失效，请打开扩展设置页点击「重新授权」");
  throw new Error("保存目录权限被拒绝，请打开扩展设置页重新选择目录");
}

async function resolveFile(relPath: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const root = await getDirHandle();
  if (!root) throw new Error("尚未选择保存目录，请先打开扩展设置页");
  await ensurePermission(root);
  const parts = relPath.split("/");
  const name = parts.pop()!;
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return { dir, name };
}

export async function writeTextFile(relPath: string, content: string): Promise<void> {
  const { dir, name } = await resolveFile(relPath);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function writeBinaryFile(relPath: string, data: Uint8Array, type: string): Promise<void> {
  const { dir, name } = await resolveFile(relPath);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([data.buffer as ArrayBuffer], { type }));
  await writable.close();
}

/** 分块写入。close 才落盘；失败时删掉已经建出的空文件。 */
export async function openBinaryWriter(relPath: string): Promise<{
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<number>;
  abort: () => Promise<void>;
}> {
  const { dir, name } = await resolveFile(relPath);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let settled = false;
  return {
    async write(data: Uint8Array) {
      if (!data.byteLength) throw new Error("PDF 分块为空");
      const copy = new ArrayBuffer(data.byteLength);
      new Uint8Array(copy).set(data);
      // 直接 write(ArrayBuffer) 会被当成 WriteParams，结果是 0 字节。
      await writable.write(new Blob([copy]));
    },
    async close() {
      if (settled) return 0;
      settled = true;
      await writable.close();
      const size = (await handle.getFile()).size;
      if (size <= 0) {
        await dir.removeEntry(name).catch(() => undefined);
        throw new Error("PDF 写入后仍是空文件");
      }
      return size;
    },
    async abort() {
      if (settled) return;
      settled = true;
      await writable.abort().catch(() => undefined);
      await dir.removeEntry(name).catch(() => undefined);
    },
  };
}

async function fileExists(relPath: string): Promise<boolean> {
  const root = await getDirHandle();
  if (!root) throw new Error("尚未选择保存目录，请先打开扩展设置页");
  await ensurePermission(root);
  const parts = relPath.split("/");
  const name = parts.pop()!;
  let dir = root;
  try {
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** 若 `stem.md` / `stem.pdf` 已存在，则依次尝试 `stem(1)`、`stem(2)`… */
export async function uniquifyStem(dir: string, stem: string): Promise<string> {
  for (let n = 0; n < 100; n++) {
    const name = n === 0 ? stem : `${stem}(${n})`;
    const md = `${dir}/${name}.md`;
    const pdf = `${dir}/${name}.pdf`;
    if (!(await fileExists(md)) && !(await fileExists(pdf))) return name;
  }
  throw new Error("同名文件过多，请清理导出目录后再试");
}
