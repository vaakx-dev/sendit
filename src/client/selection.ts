import ignore, { type Ignore } from "ignore";

export interface SelectedFile {
  readonly id: string;
  readonly file: File;
  readonly path: string;
  selected: boolean;
}

export interface SelectionEntry {
  readonly path: string;
  readonly name: string;
  readonly isDirectory: boolean;
  readonly fileCount: number;
  readonly selectedCount: number;
  readonly size: number;
}

interface PickedFile {
  readonly file: File;
  readonly path: string;
}

interface IgnoreFile {
  readonly directory: string;
  readonly depth: number;
  readonly rules: Ignore;
}

export class Selection {
  private readonly files = new Map<string, SelectedFile>();

  async setFiles(files: readonly File[]): Promise<void> {
    await this.replace(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  }

  async setDrop(transfer: DataTransfer): Promise<void> {
    const entries = [...transfer.items].map((item) => item.webkitGetAsEntry()).filter((entry) => entry !== null);
    if (!entries.some((entry) => entry.isDirectory)) return this.setFiles([...transfer.files]);

    const picked: PickedFile[] = [];
    for (const entry of entries) await readEntry(entry, "", picked);
    await this.replace(picked);
  }

  clear(): void {
    this.files.clear();
  }

  all(): SelectedFile[] {
    return [...this.files.values()];
  }

  included(): SelectedFile[] {
    return this.all().filter((file) => file.selected);
  }

  get(id: string): SelectedFile | undefined {
    return this.files.get(id);
  }

  root(): string {
    return commonRoot(this.all().map((file) => file.path));
  }

  label(): string {
    const included = this.included();
    const root = commonRoot(included.map((file) => file.path));
    const [only, ...others] = included;
    if (root) return root;
    if (only && others.length === 0) return only.file.name;
    return `${included.length} shared files`;
  }

  entries(directory: string): SelectionEntry[] {
    const prefix = directory ? `${directory}/` : "";
    const entries = new Map<string, SelectionEntry>();

    for (const file of this.files.values()) {
      if (!file.path.startsWith(prefix) || file.path === prefix) continue;
      const [name = "", ...rest] = file.path.slice(prefix.length).split("/");
      const path = prefix + name;
      const entry = entries.get(path);
      entries.set(path, {
        path,
        name,
        isDirectory: (entry?.isDirectory ?? false) || rest.length > 0,
        fileCount: (entry?.fileCount ?? 0) + 1,
        selectedCount: (entry?.selectedCount ?? 0) + Number(file.selected),
        size: (entry?.size ?? 0) + file.file.size,
      });
    }

    return [...entries.values()].sort((left, right) =>
      Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name),
    );
  }

  select(path: string, selected: boolean): void {
    for (const file of this.files.values()) {
      if (file.path === path || file.path.startsWith(`${path}/`)) file.selected = selected;
    }
  }

  private async replace(picked: readonly PickedFile[]): Promise<void> {
    const ignoreFiles = await loadIgnoreFiles(picked);
    this.files.clear();
    for (const { file, path } of picked) {
      const normalized = normalizePath(path);
      const id = crypto.randomUUID();
      this.files.set(id, { id, file, path: normalized, selected: !isIgnored(normalized, ignoreFiles) });
    }
  }
}

async function loadIgnoreFiles(picked: readonly PickedFile[]): Promise<IgnoreFile[]> {
  const gitignores = picked.filter(({ path }) => normalizePath(path).split("/").at(-1) === ".gitignore");
  const ignoreFiles = await Promise.all(gitignores.map(async ({ file, path }) => {
    const normalized = normalizePath(path);
    const slash = normalized.lastIndexOf("/");
    const directory = slash < 0 ? "" : normalized.slice(0, slash);
    return { directory, depth: directory ? directory.split("/").length : 0, rules: ignore().add(await file.text()) };
  }));
  return ignoreFiles.sort((left, right) => left.depth - right.depth || left.directory.localeCompare(right.directory));
}

function isIgnored(path: string, ignoreFiles: readonly IgnoreFile[]): boolean {
  let ignored = false;
  for (const { directory, rules } of ignoreFiles) {
    const prefix = directory ? `${directory}/` : "";
    if (!path.startsWith(prefix)) continue;
    const relativePath = path.slice(prefix.length);
    if (!relativePath || relativePath === ".gitignore") continue;
    const result = rules.test(relativePath);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}

async function readEntry(entry: FileSystemEntry, parent: string, picked: PickedFile[]): Promise<void> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (isFileEntry(entry)) {
    picked.push({ file: await new Promise<File>((resolve, reject) => entry.file(resolve, reject)), path });
    return;
  }
  if (!isDirectoryEntry(entry)) return;

  const reader = entry.createReader();
  for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
    for (const child of batch) await readEntry(child, path, picked);
  }
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function commonRoot(paths: readonly string[]): string {
  const [first] = paths;
  if (!first || paths.some((path) => !path.includes("/"))) return "";
  const root = first.slice(0, first.indexOf("/"));
  return paths.every((path) => path.startsWith(`${root}/`)) ? root : "";
}
