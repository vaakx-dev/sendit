import { icon, type IconNode } from "@vaakx-dev/vrui";
import {
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from "lucide";

const EXTENSIONS: ReadonlyArray<readonly [IconNode, readonly string[]]> = [
  [FileImage, ["avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]],
  [FileVideo, ["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm", "wmv"]],
  [FileAudio, ["aac", "flac", "m4a", "mid", "midi", "mp3", "ogg", "opus", "wav", "wma"]],
  [FileArchive, ["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"]],
  [FileJson, ["geojson", "json", "jsonl", "lock"]],
  [
    FileCode2,
    [
      "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "php", "py", "rb",
      "rs", "scss", "sh", "sql", "svelte", "swift", "toml", "ts", "tsx", "vue", "xml", "yaml", "yml",
    ],
  ],
  [FileSpreadsheet, ["csv", "ods", "tsv", "xls", "xlsx"]],
  [Database, ["db", "sqlite", "sqlite3"]],
  [FileCog, ["app", "bat", "cmd", "com", "dll", "exe", "msi", "ps1"]],
  [FileText, ["doc", "docx", "log", "md", "pdf", "rtf", "tex", "txt"]],
];

const ICON_BY_EXTENSION = new Map(
  EXTENSIONS.flatMap(([fileIcon, extensions]) => extensions.map((extension) => [extension, fileIcon] as const)),
);

export function fileTypeIcon(path: string, size = 17): HTMLElement {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return icon(ICON_BY_EXTENSION.get(extension) ?? File, size);
}
