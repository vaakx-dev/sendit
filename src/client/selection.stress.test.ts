import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { Selection } from "./selection.js";

const FILE_COUNT = 100_000;
const FOLDER_COUNT = 100_000;

function file(path: string): File {
  const value = new File([], path.split("/").at(-1) ?? path);
  Object.defineProperty(value, "webkitRelativePath", { value: path });
  return value;
}

test("selects and browses 100,000 files across 100,000 folders", { timeout: 120_000 }, async () => {
  const selection = new Selection();
  const files = Array.from({ length: FILE_COUNT }, (_, index) =>
    file(`project/folder-${index % FOLDER_COUNT}/file-${index}.txt`),
  );

  await selection.setFiles(files);
  assert.equal(selection.all().length, FILE_COUNT);
  assert.equal(selection.included().length, FILE_COUNT);
  assert.equal(selection.root(), "project");

  const entries = selection.entries("project");
  assert.equal(entries.length, FOLDER_COUNT);
  assert.equal(entries.reduce((total, entry) => total + entry.fileCount, 0), FILE_COUNT);

  selection.select("project/folder-9999", false);
  const excluded = selection.entries("project").find((entry) => entry.name === "folder-9999");
  assert.equal(excluded?.fileCount, 1);
  assert.equal(excluded?.selectedCount, 0);
  assert.equal(selection.included().length, FILE_COUNT - 1);
});
