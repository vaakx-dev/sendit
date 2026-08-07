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
  file_count: number;
  selected_count: number;
  size: number;
}

interface LocalEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

interface FileEntry extends LocalEntry {
  file(success: (file: File) => void, failure: (error: DOMException) => void): void;
}

interface DirectoryReader {
  readEntries(success: (entries: LocalEntry[]) => void, failure: (error: DOMException) => void): void;
}

interface DirectoryEntry extends LocalEntry {
  createReader(): DirectoryReader;
}

interface IgnoreFile {
  directory: string;
  rules: Ignore;
}

export class Selection {
  private records = new Map<string, SelectedFile>();

  async set_files(files: File[]): Promise<void> {
    await this.set(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  }

  async set_drop(items: DataTransferItemList, files: FileList): Promise<void> {
    const entries = [...items]
      .map((item) => item.webkitGetAsEntry?.() as unknown as LocalEntry | null)
      .filter((entry): entry is LocalEntry => entry !== null);

    if (!entries.some((entry) => entry.isDirectory)) {
      await this.set_files([...files]);
      return;
    }

    const found: Array<{ file: File; path: string }> = [];
    for (const entry of entries) await read_entry(entry, "", found);
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
    return common_root(this.all().map((record) => record.path));
  }

  label(): string {
    const records = this.included();
    const root = common_root(records.map((record) => record.path));
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
        file_count: 0,
        selected_count: 0,
        size: 0,
      };
      current.directory ||= slash >= 0;
      current.file_count += 1;
      current.size += record.file.size;
      if (record.selected) {
        current.selected_count += 1;
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
    const ignore_files = await load_ignore_files(records);

    for (const record of records) {
      const path = normalize_path(record.path);
      const ignored = is_ignored(path, ignore_files);
      const id = crypto.randomUUID();
      this.records.set(id, { id, file: record.file, path, selected: !ignored, ignored });
    }
  }
}

async function load_ignore_files(records: Array<{ file: File; path: string }>): Promise<IgnoreFile[]> {
  const files = records.filter((record) => normalize_path(record.path).split("/").at(-1) === ".gitignore");
  return await Promise.all(files.map(async (record) => {
    const path = normalize_path(record.path);
    const slash = path.lastIndexOf("/");
    return {
      directory: slash < 0 ? "" : path.slice(0, slash),
      rules: ignore().add(await record.file.text()),
    };
  }));
}

function is_ignored(path: string, files: IgnoreFile[]): boolean {
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

async function read_entry(
  entry: LocalEntry,
  parent: string,
  files: Array<{ file: File; path: string }>,
): Promise<void> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file_entry = entry as FileEntry;
    const file = await new Promise<File>((resolve, reject) => file_entry.file(resolve, reject));
    files.push({ file, path });
    return;
  }

  const reader = (entry as DirectoryEntry).createReader();
  while (true) {
    const children = await new Promise<LocalEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (children.length === 0) return;
    for (const child of children) await read_entry(child, path, files);
  }
}

function normalize_path(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function common_root(paths: string[]): string {
  if (paths.length === 0 || paths.some((path) => !path.includes("/"))) return "";
  const root = paths[0]?.split("/")[0] ?? "";
  return paths.every((path) => path.startsWith(`${root}/`)) ? root : "";
}
