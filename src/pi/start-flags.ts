/**
 * The flags that lead a task's request: `--task` (always a task), `--auto`,
 * `--fast`, `--full`, `--branch`, `--worktree` and `--no-branch`. The
 * command parses them; a session
 * started from the lobby is named from what follows them.
 */
export const START_FLAG = /^--(task|auto|fast|full|branch|worktree|no-branch)(?=\s|$)\s*/;

/** The request without its leading flags. */
export function stripStartFlags(text: string): string {
  let rest = text.trim();
  for (let match = START_FLAG.exec(rest); match; match = START_FLAG.exec(rest)) rest = rest.slice(match[0].length);
  return rest.trim();
}
