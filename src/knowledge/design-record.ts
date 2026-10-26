/**
 * The design record: the visual choices a project has settled (spacing,
 * radius, borders, shadows, hover and press, motion), kept in the Designer's
 * `design-language.md` under `## Design record` so the user edits it in the
 * Knowledge tab like any other entry. A choice is the user's (answered while
 * planning), or an agent's (made during a task where nothing was recorded,
 * for the user to overrule). What the code already settles (its tokens, or
 * the utility classes it uses most) is read from the code each time, never
 * copied in, so it cannot go stale. Planning asks only about the fields
 * neither settles; tasks never ask.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { knowledgeDir } from "./paths.ts";
import { DEFAULT_KNOWLEDGE_CONTENT, readFileOr, writeFileEnsured } from "./store.ts";

export type DesignField = "spacing" | "radius" | "borders" | "shadows" | "hover" | "motion";

interface FieldOption {
  label: string;
  description: string;
  /** The preview's CSS for this option, applied to the shared sample. */
  css: string;
}

interface FieldSpec {
  label: string;
  question: string;
  options: FieldOption[];
}

/** Each field: how it reads in the record, the question planning asks, and its options. */
export const DESIGN_FIELDS: Record<DesignField, FieldSpec> = {
  spacing: {
    label: "Spacing and padding",
    question: "How roomy should spacing and padding be?",
    options: [
      { label: "Compact", description: "tight padding (8px cards, 4px gaps), more on screen", css: ".card{padding:8px;gap:4px}.row{gap:6px}" },
      { label: "Comfortable", description: "medium padding (16px cards, 8px gaps)", css: ".card{padding:16px;gap:8px}.row{gap:10px}" },
      { label: "Roomy", description: "generous padding (24px cards, 16px gaps), calmer", css: ".card{padding:28px;gap:16px}.row{gap:14px}" },
    ],
  },
  radius: {
    label: "Corner radius",
    question: "How rounded should corners be?",
    options: [
      { label: "Sharp", description: "0 to 2px corners", css: ".card,.btn,.field{border-radius:2px}" },
      { label: "Soft", description: "6 to 8px corners", css: ".card{border-radius:10px}.btn,.field{border-radius:7px}" },
      { label: "Round", description: "12 to 16px corners", css: ".card{border-radius:18px}.btn,.field{border-radius:12px}" },
      { label: "Pill", description: "fully rounded buttons and fields, 16px cards", css: ".card{border-radius:18px}.btn,.field{border-radius:999px}" },
    ],
  },
  borders: {
    label: "Borders",
    question: "How should surfaces be separated?",
    options: [
      { label: "No borders", description: "surfaces separated by background tone only", css: ".card,.field{border:0}.card{background:#f1f2f5}.field{background:#fff}" },
      { label: "Hairline", description: "1px low-contrast borders", css: ".card,.field{border:1px solid #e3e5ea}" },
      { label: "Visible", description: "1px clearly visible borders", css: ".card,.field{border:1px solid #9aa0ab}" },
    ],
  },
  shadows: {
    label: "Shadows and depth",
    question: "How much depth should surfaces have?",
    options: [
      { label: "Flat", description: "no shadows", css: ".card{box-shadow:none}" },
      { label: "Soft", description: "a faint shadow under raised surfaces", css: ".card{box-shadow:0 1px 3px rgba(20,24,40,.08),0 1px 2px rgba(20,24,40,.06)}" },
      { label: "Elevated", description: "clear shadows that lift cards and pop-ups", css: ".card{box-shadow:0 10px 30px rgba(20,24,40,.16)}" },
    ],
  },
  hover: {
    label: "Hover and press effects",
    question: "What should buttons and rows do on hover and press?",
    options: [
      { label: "Subtle tint", description: "background darkens slightly; press darkens more", css: ".btn:hover{filter:brightness(.94)}.btn:active{filter:brightness(.86)}" },
      { label: "Lift", description: "rises 1px with a shadow; press sinks back", css: ".btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(20,24,40,.18)}.btn:active{transform:translateY(0);box-shadow:none}" },
      { label: "Springy", description: "grows a little on hover, squishes on press", css: ".btn{transition:transform .25s cubic-bezier(.34,1.56,.64,1)}.btn:hover{transform:scale(1.04)}.btn:active{transform:scale(.96)}" },
      { label: "None", description: "no hover effect beyond the cursor", css: "" },
    ],
  },
  motion: {
    label: "Motion",
    question: "How should things animate?",
    options: [
      { label: "No motion", description: "changes happen instantly", css: ".btn{transition:none}" },
      { label: "Quick and calm", description: "short fades and slides, about 150ms", css: ".btn{transition:all .15s ease-out}" },
      { label: "Playful springs", description: "springy, iOS-style motion, about 300ms", css: ".btn{transition:all .3s cubic-bezier(.34,1.56,.64,1)}" },
    ],
  },
};

export const DESIGN_FIELD_KEYS = Object.keys(DESIGN_FIELDS) as DesignField[];

export const RECORD_HEADING = "## Design record";
const RECORD_INTRO = "Settled visual choices. Agents follow these and never ask about them again; edit a line to change it.";

export interface DesignChoice {
  field: DesignField;
  value: string;
  /** `you` (the user chose it) or `agent` (an agent chose it during a task, for you to overrule). */
  by: "you" | "agent";
  /** The task it was chosen in, for an agent's choice. */
  taskId?: string;
  date?: string;
}

export function designRecordPath(dataRoot: string): string {
  return join(knowledgeDir(dataRoot, "designer"), "design-language.md");
}

export function isDesignField(value: string): value is DesignField {
  return value in DESIGN_FIELDS;
}

/** The field a line names, by its label or key. */
function fieldOf(name: string): DesignField | undefined {
  const plain = name.trim().toLowerCase();
  return DESIGN_FIELD_KEYS.find((key) => key === plain || DESIGN_FIELDS[key].label.toLowerCase() === plain);
}

const LINE = /^-\s+\*\*(.+?):\*\*\s+(.+?)\s*$/;
const SOURCE = /\s+_\((you|agent)(?:,\s*([A-Za-z0-9-]+))?(?:,\s*(\d{4}-\d{2}-\d{2}))?\)_$/;

/** The section's lines: [start, end) of `design-language.md`, or undefined when it has none. */
function sectionRange(rows: readonly string[]): [number, number] | undefined {
  const start = rows.findIndex((row) => row.trim() === RECORD_HEADING);
  if (start < 0) return undefined;
  let end = rows.findIndex((row, index) => index > start && /^#{1,2}\s/.test(row));
  if (end < 0) end = rows.length;
  return [start, end];
}

/** The choices recorded in `design-language.md`'s text; a line it cannot read is left out. */
export function parseDesignRecord(text: string): Map<DesignField, DesignChoice> {
  const rows = text.split("\n");
  const range = sectionRange(rows);
  const choices = new Map<DesignField, DesignChoice>();
  if (!range) return choices;
  for (const row of rows.slice(range[0] + 1, range[1])) {
    const line = LINE.exec(row.trim());
    const field = line ? fieldOf(line[1]!) : undefined;
    if (!line || !field) continue;
    const source = SOURCE.exec(line[2]!);
    const value = (source ? line[2]!.slice(0, source.index) : line[2]!).trim();
    if (!value) continue;
    choices.set(field, {
      field, value, by: (source?.[1] as DesignChoice["by"] | undefined) ?? "you",
      ...(source?.[2] ? { taskId: source[2] } : {}),
      ...(source?.[3] ? { date: source[3] } : {}),
    });
  }
  return choices;
}

function choiceLine(choice: DesignChoice): string {
  const source = [choice.by, choice.taskId, choice.date].filter(Boolean).join(", ");
  return `- **${DESIGN_FIELDS[choice.field].label}:** ${choice.value.replace(/\s*\n\s*/g, " ")} _(${source})_`;
}

/**
 * `design-language.md`'s text with these choices set: a field already
 * recorded is replaced in place, a new one is added in the fields' order, and
 * the section is added at the end when the file has none. Everything
 * else in the file stays as it is.
 */
export function withDesignChoices(text: string, choices: readonly DesignChoice[]): string {
  const rows = (text.trim() ? text : DEFAULT_KNOWLEDGE_CONTENT["design-language.md"]!).replace(/\n+$/, "").split("\n");
  let range = sectionRange(rows);
  if (!range) {
    rows.push("", RECORD_HEADING, "", RECORD_INTRO);
    range = sectionRange(rows)!;
  }
  const merged = parseDesignRecord(rows.join("\n"));
  for (const choice of choices) merged.set(choice.field, choice);
  const body = rows.slice(range[0] + 1, range[1]).filter((row) => {
    const line = LINE.exec(row.trim());
    return !(line && fieldOf(line[1]!));
  });
  while (body.length > 0 && body.at(-1)!.trim() === "") body.pop();
  const lines = DESIGN_FIELD_KEYS.filter((field) => merged.has(field)).map((field) => choiceLine(merged.get(field)!));
  const section = [RECORD_HEADING, ...(body.length > 0 ? body : ["", RECORD_INTRO]), "", ...lines, ""];
  return [...rows.slice(0, range[0]), ...section, ...rows.slice(range[1])].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function readDesignRecord(dataRoot: string): Map<DesignField, DesignChoice> {
  return parseDesignRecord(readFileOr(designRecordPath(dataRoot)));
}

/** Record choices in the project's design record; returns the file written. */
export function recordDesignChoices(dataRoot: string, choices: readonly DesignChoice[]): string {
  const path = designRecordPath(dataRoot);
  if (choices.length > 0) writeFileEnsured(path, withDesignChoices(readFileOr(path), choices));
  return path;
}

/** `design-language.md` without its record section: the rest of the Designer's standards. */
export function withoutDesignRecord(text: string): string {
  const rows = text.split("\n");
  const range = sectionRange(rows);
  return range ? [...rows.slice(0, range[0]), ...rows.slice(range[1])].join("\n") : text;
}

/** The value a chosen option stands for: its label and what it means, or the user's own words. */
export function choiceValue(field: DesignField, answer: string): string {
  const text = answer.trim();
  const option = DESIGN_FIELDS[field].options.find((entry) => entry.label.toLowerCase() === text.toLowerCase());
  return option ? `${option.label}: ${option.description}` : text;
}

// ---------------------------------------------------------------------------
// What the code already settles
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "coverage", "vendor", ".pi", "target", ".venv", "venv", "__pycache__"]);
const MARKUP = /\.(tsx|jsx|vue|svelte|html|astro)$/;
const MAX_FILES = 600;
const MAX_FILE_BYTES = 200_000;
const MAX_DEPTH = 6;

/** Custom properties per field, as `--name: value` in a stylesheet. */
const TOKEN_PATTERNS: Record<DesignField, RegExp> = {
  spacing: /--[\w-]*(?:spacing|space|gap|gutter|pad)[\w-]*/,
  radius: /--[\w-]*radius[\w-]*/,
  borders: /--[\w-]*border[\w-]*/,
  shadows: /--[\w-]*shadow[\w-]*/,
  hover: /--[\w-]*hover[\w-]*/,
  motion: /--[\w-]*(?:duration|ease|easing|transition|motion|spring)[\w-]*/,
};

/** Utility classes per field, counted in markup (Tailwind and lookalikes). */
const CLASS_PATTERNS: Record<DesignField, RegExp> = {
  spacing: /(?<![\w:-])(?:p[xytrbl]?|gap(?:-[xy])?|space-[xy])-(\d+(?:\.5)?)(?![\w-])/g,
  radius: /(?<![\w:-])rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?(?![\w-])/g,
  borders: /(?<![\w:-])border(?:-(?:0|2|4|8))?(?![\w-])/g,
  shadows: /(?<![\w:-])shadow(?:-(?:none|sm|md|lg|xl|2xl|inner))?(?![\w-])/g,
  hover: /(?<![\w-])(?:hover|active):[\w/.[\]-]+/g,
  motion: /(?<![\w:-])(?:transition(?:-[a-z]+)?|duration-\d+|animate-[a-z-]+)(?![\w-])/g,
};

interface CodeStyle {
  /** Stylesheets with tokens, relative to the project. */
  sheets: string[];
  tokens: Map<DesignField, string[]>;
  classes: Map<DesignField, Map<string, number>>;
  hoverRules: number;
}

function walk(root: string, visit: (path: string) => void): void {
  let seen = 0;
  const step = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || seen >= MAX_FILES) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (seen >= MAX_FILES) return;
      if (name.startsWith(".") && name !== ".storybook") continue;
      const path = join(dir, name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) step(path, depth + 1);
      } else if ((name.endsWith(".css") || MARKUP.test(name)) && stat.size <= MAX_FILE_BYTES) {
        seen += 1;
        visit(path);
      }
    }
  };
  step(root, 0);
}

/** Read the project's stylesheets and markup for what they already settle. */
export function readCodeStyle(projectRoot: string): CodeStyle {
  const style: CodeStyle = { sheets: [], tokens: new Map(), classes: new Map(), hoverRules: 0 };
  walk(projectRoot, (path) => {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return;
    }
    if (path.endsWith(".css")) {
      let found = false;
      for (const match of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
        const [, name, value] = match;
        const field = DESIGN_FIELD_KEYS.find((key) => TOKEN_PATTERNS[key].test(name!));
        if (!field) continue;
        const list = style.tokens.get(field) ?? [];
        if (list.length < 6 && !list.some((entry) => entry.startsWith(`${name}:`))) list.push(`${name}: ${value!.trim().slice(0, 60)}`);
        style.tokens.set(field, list);
        found = true;
      }
      style.hoverRules += (text.match(/:hover\b/g) ?? []).length;
      if (found && style.sheets.length < 6) style.sheets.push(relative(projectRoot, path));
      return;
    }
    for (const field of DESIGN_FIELD_KEYS) {
      const counts = style.classes.get(field) ?? new Map<string, number>();
      for (const match of text.matchAll(CLASS_PATTERNS[field])) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
      style.classes.set(field, counts);
    }
  });
  return style;
}

/** Fewer uses than this and the classes do not say what the project does. */
const MIN_CLASS_USES = 5;

/** What the code says about a field, in a line; undefined when it says nothing. */
function codeSays(style: CodeStyle, field: DesignField): string | undefined {
  const tokens = style.tokens.get(field) ?? [];
  const counts = [...(style.classes.get(field) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const uses = counts.reduce((sum, [, count]) => sum + count, 0);
  const parts: string[] = [];
  if (tokens.length > 0) parts.push(`tokens ${tokens.join(", ")}`);
  if (uses >= MIN_CLASS_USES) parts.push(`most used ${counts.slice(0, 4).map(([name, count]) => `${name} (${count}×)`).join(", ")}`);
  if (field === "hover" && style.hoverRules >= 3) parts.push(`${style.hoverRules} :hover rules in the stylesheets`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

export interface DesignStanding {
  recorded: Map<DesignField, DesignChoice>;
  /** What the code settles, per field it says something about. */
  fromCode: Map<DesignField, string>;
  sheets: string[];
  /** Fields neither the record nor the code settles: the only ones planning may ask about. */
  gaps: DesignField[];
}

export function designStanding(dataRoot: string, projectRoot: string): DesignStanding {
  const recorded = readDesignRecord(dataRoot);
  const style = readCodeStyle(projectRoot);
  const fromCode = new Map<DesignField, string>();
  for (const field of DESIGN_FIELD_KEYS) {
    const says = codeSays(style, field);
    if (says) fromCode.set(field, says);
  }
  return { recorded, fromCode, sheets: style.sheets, gaps: DESIGN_FIELD_KEYS.filter((field) => !recorded.has(field) && !fromCode.has(field)) };
}

/** The record as an agent reads it: the settled fields (yours first, then the code's) and the open ones. */
export function designRecordBlock(standing: DesignStanding, open: "planning" | "task"): string {
  const lines = ["## Design record (settled visual choices: follow them, never ask about them)"];
  for (const field of DESIGN_FIELD_KEYS) {
    const choice = standing.recorded.get(field);
    const code = standing.fromCode.get(field);
    if (choice) lines.push(`- ${DESIGN_FIELDS[field].label}: ${choice.value} (${choice.by === "you" ? "the user chose this" : `an agent chose this${choice.taskId ? ` in ${choice.taskId}` : ""}; the user may overrule it`})`);
    else if (code) lines.push(`- ${DESIGN_FIELDS[field].label}: follow the code — ${code}`);
  }
  if (lines.length === 1) lines.push("- (nothing settled yet)");
  if (standing.sheets.length > 0) lines.push(`Global stylesheets: ${standing.sheets.join(", ")}.`);
  if (standing.gaps.length === 0) return lines.join("\n");
  const open_ = standing.gaps.map((field) => `${field} (${DESIGN_FIELDS[field].label.toLowerCase()})`).join(", ");
  lines.push(open === "planning"
    ? `Not settled yet: ${open_}. If this work changes what the user sees, list the ones it touches under ## Style (their keys, comma-separated); the user is asked those once with fixed options and the answers are recorded. Do not ask them under Questions.`
    : `Not settled yet: ${open_}. Do not ask the user about them. Follow the closest pattern already in the code, and list each value you chose under "Design choices" in your report as \`- <key>: <value>\`, so it is recorded for the user to overrule.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Planning's style questions
// ---------------------------------------------------------------------------

const SAMPLE_CSS = "body{margin:0;font:14px/1.45 system-ui,sans-serif;color:#1d2230;background:#fafbfc}.page{padding:24px;display:flex;justify-content:center;zoom:2.4}.card{display:flex;flex-direction:column;background:#fff;border:1px solid #e3e5ea;border-radius:10px;padding:16px;gap:8px;width:320px}.card h3{margin:0;font-size:15px}.card p{margin:0;color:#5b6170}.field{border:1px solid #d5d8de;border-radius:7px;padding:7px 10px;color:#8a909c;background:#fff}.row{display:flex;gap:10px;justify-content:flex-end}.btn{border:0;border-radius:7px;padding:7px 14px;font:inherit;font-weight:600;cursor:pointer;background:#3b5bdb;color:#fff;transition:all .15s ease-out}.btn.ghost{background:#eceef2;color:#1d2230}";
const SAMPLE_HTML = '<div class="page"><div class="card"><h3>Invite a teammate</h3><p>They get access to this project.</p><div class="field">name@company.com</div><div class="row"><button class="btn ghost">Cancel</button><button class="btn">Send invite</button></div></div></div>';

export interface StyleQuestion {
  text: string;
  record: DesignField;
  options: Array<{ label: string; description: string; mockup: { html: string; css: string } }>;
}

/** The fixed questions for the fields asked about, each option drawn on the same small sample. */
export function styleQuestions(fields: readonly DesignField[]): StyleQuestion[] {
  return fields.map((field) => ({
    text: DESIGN_FIELDS[field].question,
    record: field,
    options: DESIGN_FIELDS[field].options.map((option) => ({ label: option.label, description: option.description, mockup: { html: SAMPLE_HTML, css: `${SAMPLE_CSS}${option.css}` } })),
  }));
}

/** The field keys a seat listed under `## Style`, in the record's order. */
export function styleFields(text: string | undefined): DesignField[] {
  if (!text) return [];
  const named = new Set(text.toLowerCase().split(/[\s,;•*-]+/).map((word) => word.trim()).filter(Boolean));
  return DESIGN_FIELD_KEYS.filter((field) => named.has(field));
}
