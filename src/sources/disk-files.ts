import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import ignore, { type Ignore } from "ignore";
import { countOf } from "../shared/format.js";
import type { SharedItem } from "../shared/protocol.js";
import type { FileSource } from "./file-source.js";

export interface DiskSelection {
  readonly label: string;
  readonly items: SharedItem[];
  readonly source: DiskFiles;
}

interface DiskFile {
  readonly path: string;
  readonly relativePath: string;
  readonly size: number;
}

interface IgnoreFile {
  readonly directory: string;
  readonly rules: Ignore;
}

export class DiskFiles implements FileSource {
  readonly status = "ready";

  constructor(private readonly paths: ReadonlyMap<string, string>) {}

  open(item: SharedItem, signal: AbortSignal): Readable {
    const path = this.paths.get(item.id);
    if (!path) throw new Error(`Unknown file: ${item.relativePath}`);
    return createReadStream(path, { signal });
  }
}

export function selectFiles(inputs: string[]): DiskSelection {
  const roots = inputs.map((input) => resolve(input));
  const files = roots.flatMap(listFiles);
  if (files.length === 0) throw new Error("Nothing to share: the folders are empty or fully ignored.");
  ensureUniquePaths(files);

  const paths = new Map<string, string>();
  const items = files.map(({ path, relativePath, size }, index) => {
    const id = String(index + 1);
    paths.set(id, path);
    return { id, relativePath, size };
  });
  return { label: labelFor(roots), items, source: new DiskFiles(paths) };
}

function labelFor(roots: readonly string[]): string {
  const [root, ...others] = roots;
  return root && others.length === 0 ? basename(root) : countOf(roots.length, "shared item");
}

function listFiles(path: string): DiskFile[] {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) throw new Error(`Cannot find ${path}`);
  if (!stats.isDirectory()) return [{ path, relativePath: basename(path), size: stats.size }];

  const files: DiskFile[] = [];
  walk(path, basename(path), [], files);
  return files;
}

function walk(directory: string, relativePath: string, inherited: IgnoreFile[], files: DiskFile[]): void {
  const ignoreFiles = [...inherited, ...readGitignore(directory)];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const entryPath = `${relativePath}/${entry.name}`;
    if (entry.name === ".git" || isIgnored(path, entry.isDirectory(), ignoreFiles)) continue;
    if (entry.isDirectory()) walk(path, entryPath, ignoreFiles, files);
    else if (entry.isFile()) files.push({ path, relativePath: entryPath, size: statSync(path).size });
  }
}

function readGitignore(directory: string): IgnoreFile[] {
  const path = join(directory, ".gitignore");
  return existsSync(path) ? [{ directory, rules: ignore().add(readFileSync(path, "utf8")) }] : [];
}

function isIgnored(path: string, isDirectory: boolean, ignoreFiles: readonly IgnoreFile[]): boolean {
  let ignored = false;
  for (const { directory, rules } of ignoreFiles) {
    const gitPath = relative(directory, path).replaceAll(sep, "/") + (isDirectory ? "/" : "");
    const result = rules.test(gitPath);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}

function ensureUniquePaths(files: readonly DiskFile[]): void {
  const seen = new Set<string>();
  for (const { relativePath } of files) {
    if (seen.has(relativePath)) throw new Error(`Two files would share the path ${relativePath}`);
    seen.add(relativePath);
  }
}
