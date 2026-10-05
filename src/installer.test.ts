import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const installer_url = new URL("install.ps1", root);

test("installer checks native failures and restores the working directory", async () => {
  const installer = await readFile(new URL("install.ps1", root), "utf8");
  assert.match(installer, /function Invoke-NativeCommand/);
  assert.match(installer, /\$exitCode = \$LASTEXITCODE[\s\S]*if \(\$exitCode -ne 0\)/);
  assert.match(installer, /Push-Location[\s\S]*try \{[\s\S]*\} finally \{[\s\S]*Pop-Location/);
  assert.match(installer, /Invoke-NativeCommand npm ci --silent/);
  assert.doesNotMatch(installer, /& (?:git|npm|node)\b/);
});

test("native command failures throw under Windows PowerShell 5.1", { skip: process.platform !== "win32" }, () => {
  const path = fileURLToPath(installer_url).replaceAll("'", "''");
  const command = [
    `. '${path}'`,
    "try {",
    "  Invoke-NativeCommand cmd.exe /c exit 7",
    "  throw 'native failure did not throw'",
    "} catch {",
    "  if ($_.Exception.Message -notmatch 'cmd.exe failed with exit code 7') { throw }",
    "  Write-Output 'caught-native-exit-7'",
    "}",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /caught-native-exit-7/);
});

test("VRUI lock resolution uses HTTPS", async () => {
  const lock = await readFile(new URL("package-lock.json", root), "utf8");
  assert.match(lock, /git\+https:\/\/github\.com\/vaakx-dev\/vrui\.git#5b5b23b5ae3cb1981866024a924bb68ea0466ba2/);
  assert.doesNotMatch(lock, /git\+ssh:\/\/git@github\.com\/vaakx-dev\/vrui/);
});
