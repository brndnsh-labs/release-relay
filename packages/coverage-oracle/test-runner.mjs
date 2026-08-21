import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSuites = [
  "compare.test.js",
  "normalize.test.js",
  "pipeline.test.js",
  "report.test.js",
  "revision.test.js",
  "schema.test.js"
];
const distDirectory = new URL("./dist/", import.meta.url);
const packageDirectory = fileURLToPath(new URL("./", import.meta.url));
const repositoryDirectory = fileURLToPath(new URL("../../", import.meta.url));
const compiledSuites = (await readdir(distDirectory))
  .filter((file) => file.endsWith(".test.js"))
  .sort();

if (
  compiledSuites.length !== expectedSuites.length ||
  compiledSuites.some((file, index) => file !== expectedSuites[index])
) {
  throw new Error(
    [
      "coverage-oracle test wiring is out of date.",
      `Expected: ${expectedSuites.join(", ")}`,
      `Compiled: ${compiledSuites.join(", ")}`,
      "Update this package entrypoint when adding or removing a compiled test suite."
    ].join("\n")
  );
}

const testProcess = spawn(
  process.execPath,
  ["--test", ...compiledSuites.map((file) => join(packageDirectory, "dist", file))],
  { cwd: repositoryDirectory, stdio: "inherit" }
);

testProcess.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
