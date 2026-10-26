/**
 * Running a command without a shell (git, gh): the real `execFile`, or a fake
 * in tests.
 */
import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs a command without a shell; `execCommand` in the extension, a fake in tests. */
export type Exec = (command: string, args: string[], options?: { cwd?: string; timeout?: number }) => Promise<ExecResult>;

/**
 * `execFile` as an `Exec`: a non-zero exit resolves with its code and output,
 * while a missing binary rejects with the spawn error (`ENOENT`), so a caller
 * can say "gh is not installed" rather than "exited with code 1".
 */
export const execCommand: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && typeof (error as NodeJS.ErrnoException).code === "string") return reject(error);
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
