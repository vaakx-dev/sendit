export interface SelectedFile {
  id: string;
  file: File;
  path: string;
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

export class Selection {
  private records = new Map<string, SelectedFile>();

  set_files(files: File[]): void {
    this.set(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  }

  async set_drop(items: DataTransferItemList, files: FileList): Promise<void> {
    const entries = [...items]
      .map((item) => item.webkitGetAsEntry?.() as unknown as LocalEntry | null)
      .filter((entry): entry is LocalEntry => entry !== null);

    if (!entries.some((entry) => entry.isDirectory)) {
      this.set_files([...files]);
      return;
    }

    const found: Array<{ file: File; path: string }> = [];
    for (const entry of entries) await read_entry(entry, "", found);
    this.set(found);
  }

  clear(): void {
    this.records.clear();
  }

  all(): SelectedFile[] {
    return [...this.records.values()];
  }

  get(id: string): SelectedFile | undefined {
    return this.records.get(id);
  }

  label(): string {
    const records = this.all();
    const root = common_root(records.map((record) => record.path));
    if (root) return root;
    if (records.length === 1) return records[0]?.file.name ?? "Shared file";
    return `${records.length} shared files`;
  }

  private set(records: Array<{ file: File; path: string }>): void {
    this.records.clear();
    for (const record of records) {
      const id = crypto.randomUUID();
      this.records.set(id, { id, ...record });
    }
  }
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

function common_root(paths: string[]): string {
  if (paths.length === 0 || paths.some((path) => !path.includes("/"))) return "";
  const root = paths[0]?.split("/")[0] ?? "";
  return paths.every((path) => path.startsWith(`${root}/`)) ? root : "";
}
