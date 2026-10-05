import { icon } from "@vaakx-dev/vrui";
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

type FileIcon = Parameters<typeof icon>[0];

const image = new Set(["avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const video = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm", "wmv"]);
const audio = new Set(["aac", "flac", "m4a", "mid", "midi", "mp3", "ogg", "opus", "wav", "wma"]);
const archive = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"]);
const code = new Set([
  "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "php", "py", "rb",
  "rs", "scss", "sh", "sql", "svelte", "swift", "toml", "ts", "tsx", "vue", "xml", "yaml", "yml",
]);
const json = new Set(["geojson", "json", "jsonl", "lock"]);
const text = new Set(["doc", "docx", "log", "md", "pdf", "rtf", "tex", "txt"]);
const spreadsheet = new Set(["csv", "ods", "tsv", "xls", "xlsx"]);
const database = new Set(["db", "sqlite", "sqlite3"]);
const executable = new Set(["app", "bat", "cmd", "com", "dll", "exe", "msi", "ps1"]);

export function file_type_icon(path: string, size = 17): HTMLElement {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  let value: FileIcon = File;
  if (image.has(extension)) value = FileImage;
  else if (video.has(extension)) value = FileVideo;
  else if (audio.has(extension)) value = FileAudio;
  else if (archive.has(extension)) value = FileArchive;
  else if (json.has(extension)) value = FileJson;
  else if (code.has(extension)) value = FileCode2;
  else if (spreadsheet.has(extension)) value = FileSpreadsheet;
  else if (database.has(extension)) value = Database;
  else if (executable.has(extension)) value = FileCog;
  else if (text.has(extension)) value = FileText;
  return icon(value, size);
}
