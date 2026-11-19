import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, runCli, type CliIo } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "devflow-init-"));
  roots.push(root);
  return root;
}

async function init(cwd: string, args: string[]) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    cwd,
    env: {},
  };
  const code = await runCli(["init", ...args], io);
  return { code, stdout, stderr };
}

/** Every entry under `root` with its size and modification time, to detect any change. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name);
    const info = await stat(full);
    const content = entry.isFile() ? await readFile(full, "utf8") : "";
    out[path.relative(root, full)] = `${info.mtimeMs}:${info.size}:${content}`;
  }
  return out;
}

describe("devflow init --dry-run", () => {
  it("writes nothing in an empty directory and says what it would create", async () => {
    const root = await workspace();
    const before = await snapshot(root);
    const result = await init(root, ["--dry-run"]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain("would create  .devflow/config.yaml");
    expect(result.stdout).toContain("would create  .devflow/rules/project.md");
    expect(result.stdout).toContain("would add  .devflow/runs/ to .gitignore");
    expect(result.stdout).toContain("provider: anthropic");
    expect(await snapshot(root)).toEqual(before);
    expect(await readdir(root)).toEqual([]);
  });

  it("leaves an existing repository byte for byte unchanged", async () => {
    const root = await workspace();
    await mkdir(path.join(root, ".devflow", "rules"), { recursive: true });
    await writeFile(path.join(root, ".devflow", "config.yaml"), "version: 1\n");
    await writeFile(path.join(root, ".gitignore"), "node_modules");
    const before = await snapshot(root);
    const result = await init(root, ["--dry-run"]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain("would keep    .devflow/config.yaml (already exists)");
    expect(result.stdout).toContain("would create  .devflow/rules/project.md");
    expect(result.stdout).toContain("would add  .devflow/runs/ to .gitignore");
    // The existing config is not written, so it is not printed either.
    expect(result.stdout).not.toContain("would contain");
    expect(await snapshot(root)).toEqual(before);
  });

  it("reports an already ignored run directory", async () => {
    const root = await workspace();
    await writeFile(path.join(root, ".gitignore"), ".devflow/runs/\n");
    const result = await init(root, ["--dry-run"]);
    expect(result.stdout).toContain("already ignored  .gitignore (.devflow/runs/)");
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(".devflow/runs/\n");
  });

  it("returns the same information as JSON with dryRun: true", async () => {
    const root = await workspace();
    const before = await snapshot(root);
    const result = await init(root, ["--dry-run", "--json", "--provider", "agent"]);
    expect(result.code).toBe(ExitCode.Success);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output).toMatchObject({
      dryRun: true,
      wouldCreate: [".devflow/config.yaml", ".devflow/rules/project.md"],
      wouldKeep: [],
      gitignore: "would-add",
    });
    expect(output.config).toMatch(/^ {2}provider: agent$/m);
    expect(await snapshot(root)).toEqual(before);
  });

  it("is what a real run then does", async () => {
    const root = await workspace();
    const dry = JSON.parse((await init(root, ["--dry-run", "--json"])).stdout) as {
      wouldCreate: string[];
    };
    const real = JSON.parse((await init(root, ["--json"])).stdout) as { created: string[] };
    expect(real.created).toEqual(dry.wouldCreate);
    const again = JSON.parse((await init(root, ["--dry-run", "--json"])).stdout) as {
      wouldCreate: string[];
      wouldKeep: string[];
      gitignore: string;
    };
    expect(again).toMatchObject({ wouldCreate: [], gitignore: "present" });
    expect(again.wouldKeep).toEqual(real.created);
  });
});
