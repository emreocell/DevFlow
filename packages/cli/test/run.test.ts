import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExitCode, runCli, type CliIo } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "devflow-cli-"));
  await writeFile(
    path.join(dir, "invalid.yaml"),
    [
      "id: T-1",
      "title: Broken",
      "acceptanceCriteria:",
      "  - statement: a",
      "    covers: [FR-9]",
    ].join("\n"),
  );
  await writeFile(path.join(dir, "warnings.yaml"), "id: T-2\ntitle: Only warnings\n");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(args: string[], cwd = repoRoot): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    cwd,
    env: {},
  };
  const code = await runCli(args, io);
  return { code, stdout, stderr };
}

describe("devflow (general)", () => {
  it("prints the version", async () => {
    const result = await run(["--version"]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints help with --help", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain("task");
  });

  it("returns a usage error without a command", async () => {
    const result = await run([]);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain("Usage: devflow");
  });

  it("returns a usage error for unknown commands", async () => {
    const result = await run(["deploy"]);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain("unknown command");
  });

  it("returns a usage error when the file argument is missing", async () => {
    const result = await run(["task", "validate"]);
    expect(result.code).toBe(ExitCode.UsageError);
  });
});

describe("devflow task validate", () => {
  it.each([
    "examples/tasks/add-pagination.task.yaml",
    "examples/tasks/add-pagination.task.md",
    "examples/tasks/export-orders-csv.task.json",
  ])("accepts %s", async (file) => {
    const result = await run(["task", "validate", file]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain(`Task file: ${file}`);
    expect(result.stdout).toContain("Result: VALID");
  });

  it("reports errors with line numbers and exits with 1", async () => {
    const result = await run(["task", "validate", "invalid.yaml"], dir);
    expect(result.code).toBe(ExitCode.Failure);
    expect(result.stdout).toContain("TASK_UNKNOWN_REQUIREMENT_REF");
    expect(result.stdout).toContain("line 5  acceptanceCriteria[0].covers[0]");
    expect(result.stdout).toContain("AC-1 covers FR-9, but no requirement has that id");
    expect(result.stdout).toContain("Result: INVALID (1 error, 1 warning)");
  });

  it("accepts warnings by default and rejects them with --strict", async () => {
    const lenient = await run(["task", "validate", "warnings.yaml"], dir);
    expect(lenient.code).toBe(ExitCode.Success);
    expect(lenient.stdout).toContain("Result: VALID (2 warnings)");

    const strict = await run(["task", "validate", "--strict", "warnings.yaml"], dir);
    expect(strict.code).toBe(ExitCode.Failure);
    expect(strict.stdout).toContain("strict mode: 2 warnings treated as errors");
  });

  it("prints machine-readable output with --json", async () => {
    const result = await run(["task", "validate", "--json", "invalid.yaml"], dir);
    expect(result.code).toBe(ExitCode.Failure);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output).toMatchObject({
      file: "invalid.yaml",
      format: "yaml",
      valid: false,
      errorCount: 1,
      warningCount: 1,
    });
    expect((output.issues as { location: string }[])[0]?.location).toBe(
      "acceptanceCriteria[0].covers[0]",
    );
    expect((output.task as { id: string }).id).toBe("T-1");
  });

  it("reports unusable files as usage errors", async () => {
    const human = await run(["task", "validate", "missing.yaml"], dir);
    expect(human.code).toBe(ExitCode.UsageError);
    expect(human.stderr).toContain("TASK_FILE_NOT_FOUND");

    const json = await run(["task", "validate", "--json", "missing.yaml"], dir);
    expect(json.code).toBe(ExitCode.UsageError);
    expect(JSON.parse(json.stdout)).toMatchObject({
      valid: false,
      error: { code: "TASK_FILE_NOT_FOUND" },
    });
  });

  it("validates several files: one block each, a summary line, worst exit code", async () => {
    const result = await run(["task", "validate", "warnings.yaml", "invalid.yaml"], dir);
    expect(result.code).toBe(ExitCode.Failure);
    expect(result.stdout).toContain("Task file: warnings.yaml");
    expect(result.stdout).toContain("Result: VALID (2 warnings)");
    expect(result.stdout).toContain("Task file: invalid.yaml");
    expect(result.stdout).toContain("Result: INVALID (1 error, 1 warning)");
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("2 files: 1 valid, 1 invalid");
  });

  it("summarises several valid files and exits 0", async () => {
    const result = await run([
      "task",
      "validate",
      "examples/tasks/add-pagination.task.yaml",
      "examples/tasks/export-orders-csv.task.json",
    ]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("2 files: 2 valid, 0 invalid");
  });

  it("applies --strict to every file", async () => {
    const lenient = await run(["task", "validate", "warnings.yaml", "warnings.yaml"], dir);
    expect(lenient.code).toBe(ExitCode.Success);
    const strict = await run(
      ["task", "validate", "--strict", "warnings.yaml", "warnings.yaml"],
      dir,
    );
    expect(strict.code).toBe(ExitCode.Failure);
    expect(strict.stdout.trimEnd().split("\n").at(-1)).toBe("2 files: 0 valid, 2 invalid");
  });

  it("prints { files: [...] } with --json for several files", async () => {
    const result = await run(["task", "validate", "--json", "warnings.yaml", "invalid.yaml"], dir);
    expect(result.code).toBe(ExitCode.Failure);
    const output = JSON.parse(result.stdout) as { files: Record<string, unknown>[] };
    expect(Object.keys(output)).toEqual(["files"]);
    expect(output.files).toHaveLength(2);
    expect(output.files[0]).toMatchObject({ file: "warnings.yaml", valid: true, warningCount: 2 });
    expect(output.files[1]).toMatchObject({ file: "invalid.yaml", valid: false, errorCount: 1 });
  });

  it("keeps the single-file --json output unchanged (no files wrapper)", async () => {
    const result = await run(["task", "validate", "--json", "warnings.yaml"], dir);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output).toMatchObject({ file: "warnings.yaml", valid: true });
    expect(output).not.toHaveProperty("files");
  });

  it("exits 2 when any of several files is unusable and still reports the others", async () => {
    const human = await run(["task", "validate", "warnings.yaml", "missing.yaml"], dir);
    expect(human.code).toBe(ExitCode.UsageError);
    expect(human.stdout).toContain("Task file: warnings.yaml");
    expect(human.stderr).toContain("TASK_FILE_NOT_FOUND");
    expect(human.stdout.trimEnd().split("\n").at(-1)).toBe("2 files: 1 valid, 1 invalid");

    const json = await run(["task", "validate", "--json", "warnings.yaml", "missing.yaml"], dir);
    expect(json.code).toBe(ExitCode.UsageError);
    const output = JSON.parse(json.stdout) as { files: Record<string, unknown>[] };
    expect(output.files[1]).toMatchObject({ valid: false, error: { code: "TASK_FILE_NOT_FOUND" } });
  });

  it("does not emit color codes when output is not a terminal", async () => {
    const result = await run(["task", "validate", "invalid.yaml"], dir);
    // eslint-disable-next-line no-control-regex
    expect(result.stdout).not.toMatch(/\u001b\[/);
  });
});
