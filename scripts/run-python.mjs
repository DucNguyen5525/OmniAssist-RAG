import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-python.mjs [--venv <directory>] <python args...>");
  process.exit(2);
}

let candidates;
if (args[0] === "--venv") {
  const venvDirectory = args[1];
  if (!venvDirectory || args.length < 3) {
    console.error("--venv requires a directory and Python arguments.");
    process.exit(2);
  }
  args.splice(0, 2);
  const executable = path.resolve(
    venvDirectory,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
  );
  if (!fs.existsSync(executable)) {
    console.error(`Virtualenv Python was not found: ${executable}`);
    process.exit(1);
  }
  candidates = [[executable]];
} else {
  candidates =
    process.platform === "win32"
      ? [["python3.14"], ["python3"], ["python"], ["py", "-3"]]
      : [["python3"], ["python"]];
}

for (const [command, ...prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, "--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  if (probe.status !== 0) continue;

  const result = spawnSync(command, [...prefix, ...args], {
    stdio: "inherit",
    windowsHide: true
  });
  process.exit(result.status ?? 1);
}

console.error("No working Python 3 interpreter was found.");
process.exit(1);
