import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";

export interface SharedFile {
  path: string;
  name: string;
  size: number;
}

export interface Share {
  name: string;
  files: SharedFile[];
  single: SharedFile | null;
}

interface IgnoreFile {
  directory: string;
  rules: Ignore;
}

export function collect(inputs: string[]): Share {
  const paths = inputs.map((input) => resolve(input));
  const files = paths.flatMap(list);
  const [first] = files;
  if (!first) throw new Error("Nothing to share: the folders are empty or fully ignored.");
  ensure_unique_names(files);

  const [path] = paths;
  if (!path || paths.length > 1) return { name: "sendit.zip", files, single: null };
  if (first.path === path) return { name: first.name, files, single: first };
  return { name: `${basename(path)}.zip`, files, single: null };
}

function list(path: string): SharedFile[] {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) throw new Error(`Cannot find ${path}`);
  if (!stats.isDirectory()) return [{ path, name: basename(path), size: stats.size }];

  const files: SharedFile[] = [];
  walk(path, basename(path), [], files);
  return files;
}

function walk(directory: string, name: string, inherited: IgnoreFile[], files: SharedFile[]): void {
  const ignore_files = [...inherited, ...read_gitignore(directory)];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const entry_name = `${name}/${entry.name}`;
    if (entry.name === ".git" || is_ignored(path, entry.isDirectory(), ignore_files)) continue;
    if (entry.isDirectory()) walk(path, entry_name, ignore_files, files);
    else if (entry.isFile()) files.push({ path, name: entry_name, size: statSync(path).size });
  }
}

function read_gitignore(directory: string): IgnoreFile[] {
  const path = join(directory, ".gitignore");
  return existsSync(path) ? [{ directory, rules: ignore().add(readFileSync(path, "utf8")) }] : [];
}

function is_ignored(path: string, is_directory: boolean, ignore_files: IgnoreFile[]): boolean {
  let ignored = false;
  for (const { directory, rules } of ignore_files) {
    const git_path = relative(directory, path).replaceAll(sep, "/") + (is_directory ? "/" : "");
    const result = rules.test(git_path);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}

function ensure_unique_names(files: SharedFile[]): void {
  const names = new Set<string>();
  for (const { name } of files) {
    if (names.has(name)) throw new Error(`Two files would share the name ${name}`);
    names.add(name);
  }
}
