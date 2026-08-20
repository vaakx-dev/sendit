import ignore, { type Ignore } from "ignore";

export interface SelectedFile {
  id: string;
  file: File;
  path: string;
  selected: boolean;
  ignored: boolean;
}

export interface SelectionEntry {
  path: string;
  name: string;
  directory: boolean;
  fileCount: number;
  selectedCount: number;
  size: number;
}

interface EntryBase {
  name: string;
}

interface FileEntry extends EntryBase {
  isFile: true;
  isDirectory: false;
  file(success: (file: File) => void, failure: (error: DOMException) => void): void;
}

interface DirectoryReader {
  readEntries(success: (entries: unknown[]) => void, failure: (error: DOMException) => void): void;
}

interface DirectoryEntry extends EntryBase {
  isFile: false;
  isDirectory: true;
  createReader(): DirectoryReader;
}

type LocalEntry = FileEntry | DirectoryEntry;

interface IgnoreFile {
  directory: string;
  depth: number;
  rules: Ignore;
}

export class Selection {
  private records = new Map<string, SelectedFile>();

  async setFiles(files: File[]): Promise<void> {
    await this.set(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  }

  async setDrop(items: DataTransferItemList, files: FileList): Promise<void> {
    const entries = [...items]
      .map((item): unknown => item.webkitGetAsEntry?.())
      .filter(isLocalEntry);

    if (!entries.some((entry) => entry.isDirectory)) {
      await this.setFiles([...files]);
      return;
    }

    const found: Array<{ file: File; path: string }> = [];
    for (const entry of entries) await readEntry(entry, "", found);
    await this.set(found);
  }

  clear(): void {
    this.records.clear();
  }

  all(): SelectedFile[] {
    return [...this.records.values()];
  }

  included(): SelectedFile[] {
    return this.all().filter((record) => record.selected);
  }

  get(id: string): SelectedFile | undefined {
    return this.records.get(id);
  }

  root(): string {
    return commonRoot(this.all().map((record) => record.path));
  }

  label(): string {
    const records = this.included();
    const root = commonRoot(records.map((record) => record.path));
    if (root) return root;
    if (records.length === 1) return records[0]?.file.name ?? "Shared file";
    return `${records.length} shared files`;
  }

  entries(directory: string): SelectionEntry[] {
    const entries = new Map<string, SelectionEntry>();
    const prefix = directory ? `${directory}/` : "";

    for (const record of this.records.values()) {
      if (!record.path.startsWith(prefix)) continue;
      const relative = record.path.slice(prefix.length);
      if (!relative) continue;
      const slash = relative.indexOf("/");
      const name = slash < 0 ? relative : relative.slice(0, slash);
      const path = prefix + name;
      const current = entries.get(path) ?? {
        path,
        name,
        directory: slash >= 0,
        fileCount: 0,
        selectedCount: 0,
        size: 0,
      };
      current.directory ||= slash >= 0;
      current.fileCount += 1;
      current.size += record.file.size;
      if (record.selected) {
        current.selectedCount += 1;
      }
      entries.set(path, current);
    }

    return [...entries.values()].sort((left, right) =>
      Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name),
    );
  }

  select(path: string, selected: boolean): void {
    const prefix = `${path}/`;
    for (const record of this.records.values()) {
      if (record.path === path || record.path.startsWith(prefix)) record.selected = selected;
    }
  }

  private async set(records: Array<{ file: File; path: string }>): Promise<void> {
    this.records.clear();
    const ignoreFiles = await loadIgnoreFiles(records);

    for (const record of records) {
      const path = normalizePath(record.path);
      const ignored = isIgnored(path, ignoreFiles);
      const id = crypto.randomUUID();
      this.records.set(id, { id, file: record.file, path, selected: !ignored, ignored });
    }
  }
}

async function loadIgnoreFiles(records: Array<{ file: File; path: string }>): Promise<IgnoreFile[]> {
  const files = records.filter((record) => normalizePath(record.path).split("/").at(-1) === ".gitignore");
  const ignoreFiles = await Promise.all(files.map(async (record) => {
    const path = normalizePath(record.path);
    const slash = path.lastIndexOf("/");
    const directory = slash < 0 ? "" : path.slice(0, slash);
    return {
      directory,
      depth: directory ? directory.split("/").length : 0,
      rules: ignore().add(await record.file.text()),
    };
  }));
  return ignoreFiles.sort((left, right) =>
    left.depth - right.depth || left.directory.localeCompare(right.directory),
  );
}

function isIgnored(path: string, files: IgnoreFile[]): boolean {
  let ignored = false;
  for (const file of files) {
    const prefix = file.directory ? `${file.directory}/` : "";
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (!relative || relative === ".gitignore") continue;
    const result = file.rules.test(relative);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}

async function readEntry(
  entry: LocalEntry,
  parent: string,
  files: Array<{ file: File; path: string }>,
): Promise<void> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    files.push({ file, path });
    return;
  }

  const reader = entry.createReader();
  while (true) {
    const children = await new Promise<unknown[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (children.length === 0) return;
    for (const child of children) {
      if (isLocalEntry(child)) await readEntry(child, path, files);
    }
  }
}

function isLocalEntry(value: unknown): value is LocalEntry {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  if (value.isFile === true && value.isDirectory === false) return typeof value.file === "function";
  if (value.isFile === false && value.isDirectory === true) {
    return typeof value.createReader === "function";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function commonRoot(paths: string[]): string {
  if (paths.length === 0 || paths.some((path) => !path.includes("/"))) return "";
  const root = paths[0]?.split("/")[0] ?? "";
  return paths.every((path) => path.startsWith(`${root}/`)) ? root : "";
}
