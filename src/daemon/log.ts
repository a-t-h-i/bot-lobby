/** The daemon's log: plain lines on stderr (the herdr tab that runs it shows them). Never secrets. */
export function log(line: string): void {
  process.stderr.write(`bot-lobby: ${line.replace(/\s+$/, "")}\n`);
}
