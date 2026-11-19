import {
  formatIssuePath,
  isDevflowError,
  loadTaskFile,
  type LoadedTask,
  type TaskContract,
  type ValidationIssue,
} from "@devflowai/core";
import { ExitCode } from "../exit-codes.js";
import { colorsFor, type CliIo, type Colors } from "../io.js";

export interface TaskValidateOptions {
  readonly json: boolean;
  readonly strict: boolean;
}

/** The result of validating one file, ready to be printed. */
interface FileOutcome {
  readonly code: ExitCode;
  readonly json: Record<string, unknown>;
  /** Human report for stdout, or the one-line message for stderr when the file is unusable. */
  readonly stdout?: string;
  readonly stderr?: string;
}

/**
 * `devflow task validate <file...>`: parse, normalize and lint one or more task files.
 *
 * With one file the output is exactly what it was before multiple files were accepted. With
 * several, the human output is one block per file followed by a summary line, `--json` prints
 * `{ files: [...] }`, and the exit code is the worst of the individual results.
 */
export async function taskValidateCommand(
  files: readonly string[],
  options: TaskValidateOptions,
  io: CliIo,
): Promise<ExitCode> {
  const outcomes: FileOutcome[] = [];
  for (const file of files) outcomes.push(await validateFile(file, options, io));
  let code: ExitCode = ExitCode.Success;
  for (const outcome of outcomes) if (outcome.code > code) code = outcome.code;

  if (files.length === 1) {
    const [only] = outcomes;
    if (only !== undefined) {
      if (options.json) {
        writeJson(io, only.json);
      } else {
        if (only.stdout !== undefined) io.stdout.write(only.stdout);
        if (only.stderr !== undefined) io.stderr.write(only.stderr);
      }
    }
    return code;
  }

  if (options.json) {
    writeJson(io, { files: outcomes.map((outcome) => outcome.json) });
    return code;
  }
  const valid = outcomes.filter((outcome) => outcome.code === ExitCode.Success).length;
  for (const outcome of outcomes) {
    if (outcome.stdout !== undefined) io.stdout.write(`${outcome.stdout}\n`);
    if (outcome.stderr !== undefined) io.stderr.write(outcome.stderr);
  }
  io.stdout.write(
    `${plural(outcomes.length, "file")}: ${valid} valid, ${outcomes.length - valid} invalid\n`,
  );
  return code;
}

async function validateFile(
  file: string,
  options: TaskValidateOptions,
  io: CliIo,
): Promise<FileOutcome> {
  let loaded: LoadedTask;
  try {
    loaded = await loadTaskFile(file, { cwd: io.cwd });
  } catch (error) {
    if (!isDevflowError(error)) throw error;
    return {
      code: ExitCode.UsageError,
      json: { file, valid: false, error: { code: error.code, message: error.message } },
      stderr: `devflow: ${error.message} [${error.code}]\n`,
    };
  }

  const errors = loaded.issues.filter((issue) => issue.severity === "error");
  const warnings = loaded.issues.filter((issue) => issue.severity === "warning");
  const strictFailure = options.strict && warnings.length > 0;
  const valid = loaded.valid && !strictFailure;

  return {
    code: valid ? ExitCode.Success : ExitCode.Failure,
    json: {
      file: loaded.contract?.source.ref ?? file,
      format: loaded.format,
      valid,
      strict: options.strict,
      errorCount: errors.length,
      warningCount: warnings.length,
      issues: loaded.issues.map((issue) => ({ ...issue, location: formatIssuePath(issue.path) })),
      task: loaded.contract ?? null,
    },
    stdout: renderHuman(io, file, loaded, { valid, strictFailure, errors, warnings }),
  };
}

function renderHuman(
  io: CliIo,
  file: string,
  loaded: LoadedTask,
  summary: {
    valid: boolean;
    strictFailure: boolean;
    errors: readonly ValidationIssue[];
    warnings: readonly ValidationIssue[];
  },
): string {
  const c = colorsFor(io.stdout, io.env);
  const out: string[] = [];
  out.push(`${c.bold("Task file:")} ${loaded.contract?.source.ref ?? file} (${loaded.format})`);
  if (loaded.contract !== undefined) {
    out.push(`${c.bold("Task:")}      ${loaded.contract.id} - ${loaded.contract.title}`);
    out.push(`${c.bold("Contents:")}  ${describeContents(loaded.contract)}`);
  }
  if (loaded.issues.length > 0) out.push("");
  for (const issue of loaded.issues) out.push(...renderIssue(issue, c));
  out.push("");

  const counts = [
    plural(summary.errors.length, "error"),
    plural(summary.warnings.length, "warning"),
  ]
    .filter((text) => !text.startsWith("0 "))
    .join(", ");
  if (summary.valid) {
    out.push(`${c.bold("Result:")} ${c.green("VALID")}${counts === "" ? "" : ` (${counts})`}`);
  } else if (summary.strictFailure && summary.errors.length === 0) {
    out.push(
      `${c.bold("Result:")} ${c.red("INVALID")} (strict mode: ${plural(summary.warnings.length, "warning")} treated as errors)`,
    );
  } else {
    out.push(`${c.bold("Result:")} ${c.red("INVALID")} (${counts})`);
  }
  return `${out.join("\n")}\n`;
}

function renderIssue(issue: ValidationIssue, c: Colors): string[] {
  const severity = issue.severity === "error" ? c.red("error  ") : c.yellow("warning");
  const where = [
    issue.line === undefined ? undefined : `line ${issue.line}`,
    issue.path.length === 0 ? undefined : formatIssuePath(issue.path),
  ]
    .filter((part) => part !== undefined)
    .join("  ");
  return [`${severity}  ${c.dim(issue.code)}  ${where}`.trimEnd(), `         ${issue.message}`];
}

function describeContents(contract: TaskContract): string {
  return [
    plural(contract.requirements.functional.length, "functional requirement"),
    plural(contract.requirements.nonFunctional.length, "non-functional requirement"),
    plural(contract.acceptanceCriteria.length, "acceptance criterion", "acceptance criteria"),
    plural(contract.definitionOfDone.length, "definition-of-done item"),
  ].join(", ");
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
