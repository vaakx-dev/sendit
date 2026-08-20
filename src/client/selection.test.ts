import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { Selection } from "./selection.js";

function file(path: string, content = "x"): File {
  const value = new File([content], path.split("/").at(-1) ?? path);
  Object.defineProperty(value, "webkitRelativePath", { value: path });
  return value;
}

test("gitignore matches are excluded by default and can be selected again", async () => {
  const selection = new Selection();
  await selection.setFiles([
    file("project/.gitignore", "node_modules/\n*.log\n.env\n!keep.log\n"),
    file("project/src/index.ts"),
    file("project/node_modules/package/index.js"),
    file("project/debug.log"),
    file("project/keep.log"),
    file("project/.env"),
  ]);

  assert.deepEqual(
    selection.included().map((record) => record.path).sort(),
    ["project/.gitignore", "project/keep.log", "project/src/index.ts"],
  );

  selection.select("project/node_modules", true);
  assert.equal(selection.included().some((record) => record.path.endsWith("index.js")), true);
});

test("nested gitignore files apply relative to their directory", async () => {
  const selection = new Selection();
  await selection.setFiles([
    file("project/.gitignore", "dist/\n"),
    file("project/packages/app/.gitignore", "generated/\n"),
    file("project/packages/app/generated/data.ts"),
    file("project/packages/app/src/main.ts"),
    file("project/dist/app.js"),
  ]);

  assert.deepEqual(
    selection.included().map((record) => record.path).sort(),
    ["project/.gitignore", "project/packages/app/.gitignore", "project/packages/app/src/main.ts"],
  );
});

test("nested gitignore precedence does not depend on file enumeration order", async () => {
  const rootIgnore = file("project/.gitignore", "!sub/secret.txt\n");
  const nestedIgnore = file("project/sub/.gitignore", "secret.txt\n");
  const secret = file("project/sub/secret.txt");

  for (const files of [
    [rootIgnore, nestedIgnore, secret],
    [nestedIgnore, rootIgnore, secret],
  ]) {
    const selection = new Selection();
    await selection.setFiles(files);
    assert.equal(selection.included().some((record) => record.path === "project/sub/secret.txt"), false);
  }
});

test("folder entries summarize and toggle thousands of files", async () => {
  const selection = new Selection();
  const files = Array.from({ length: 5_000 }, (_, index) =>
    file(`project/src/group-${index % 20}/file-${index}.txt`, `${index}`),
  );
  await selection.setFiles(files);

  const root = selection.entries("project");
  assert.deepEqual(root.map((entry) => entry.name), ["src"]);
  assert.equal(root[0]?.fileCount, 5_000);
  assert.equal(root[0]?.selectedCount, 5_000);

  selection.select("project/src/group-7", false);
  const source = selection.entries("project/src");
  const excluded = source.find((entry) => entry.name === "group-7");
  assert.equal(excluded?.fileCount, 250);
  assert.equal(excluded?.selectedCount, 0);
  assert.equal(selection.included().length, 4_750);
});
