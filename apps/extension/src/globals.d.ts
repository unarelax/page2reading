// File System Access API 类型声明（TS 标准库尚未内置，避免额外依赖）。
interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  kind: "file";
  name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle {
  kind: "directory";
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  queryPermission(desc?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(desc?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface FileSystemPickerOptions {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: string | FileSystemHandle;
}

interface Window {
  showDirectoryPicker(options?: FileSystemPickerOptions): Promise<FileSystemDirectoryHandle>;
}

declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export function gfm(service: TurndownService): void;
}
