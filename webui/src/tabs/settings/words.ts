/**
 * The settings page's copy: group names, labels, help lines and value
 * descriptions. Nothing secret is ever stored or shown.
 */

/** The agents in the order the page lists them: the master first, then every subagent. */
export const AGENT_ORDER = [
  "master",
  "designer",
  "backend",
  "qa",
  "scout",
  "researcher",
  "quickfix",
  "planner",
] as const

export type AgentKind = (typeof AGENT_ORDER)[number]

/** What each agent is called. */
export const AGENT_LABELS: Record<AgentKind, string> = {
  master: "Master",
  designer: "Designer",
  backend: "Backend",
  qa: "QA",
  scout: "Scout",
  researcher: "Researcher",
  quickfix: "Quick fix",
  planner: "Planner",
}

export const FIELD_LABELS = {
  model: "Model",
  thinking: "Effort",
  timeout: "Time limit",
  instructions: "Instructions",
} as const

/** `inherit` keeps the live session's model; the master alone may choose it. */
export const INHERIT_MODEL = "inherit"
export const INHERIT_LABEL = "inherit"
export const INHERIT_HELP = "Use the session's current model"
export const CUSTOM_MODEL = "__custom__"
export const CUSTOM_LABEL = "custom…"
export const CUSTOM_HELP = "Type a provider/model id"
export const FIXED_SCOUT_THINKING = "low"
/** Every effort level, lowest to highest; a model supports only some of them. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const

/** The page's groups. */
export const GROUP_TITLES = {
  agents: "Agents",
  workflow: "Workflow",
  lint: "Linting",
  lobby: "Lobby",
  classifier: "Classifier",
  appearance: "Appearance",
  notifications: "Notifications",
  install: "Install as app",
} as const

/** The lobby's on/off switches. `panel:*` are the Lobby tab's panes. */
export const LOBBY_SWITCH_ITEMS = [
  { id: "startOn", label: "On when pi starts", help: "off: pi starts as plain pi, and ctrl+shift+m or /bot-lobby on turns bot-lobby on (a session that owns a task under way always starts on)" },
  { id: "issues", label: "Issues tab", help: "the GitHub Issues tab" },
] as const

/** The panes the Lobby tab can show. */
export const PANEL_ITEMS = [
  { id: "conversation", label: "Conversation pane" },
  { id: "activity", label: "Activity log pane" },
  { id: "thinking", label: "Thinking bubble" },
] as const
export const PANEL_HELP = "shown on the Lobby tab"

export const ROUNDS_LABEL = "Planning rounds"
export const ROUNDS_HELP = "how many rounds the panel gets before the oracle settles the rest alone"
/** `PLANNING_ROUND_CHOICES`: 0 = unlimited. */
export const ROUND_CHOICES = [2, 3, 5, 8, 0] as const
export const SPLIT_LABEL = "Split long plans"
export const SPLIT_HELP = "saving a plan with more steps offers to split it into up to 5 tasks"
/** `SPLIT_PLAN_CHOICES`: 0 = never. */
export const SPLIT_CHOICES = [6, 8, 10, 12, 0] as const

export const WEB_PORT_LABEL = "Port"
export const WEB_PORT_HELP = "the base port (then the next free up to +20); 0 means any free port; applies the next time pi starts"
export const WEB_BROWSER_LABEL = "Open browser"
export const WEB_BROWSER_HELP = "open this page in the browser when pi starts"

/** What each git isolation mode does. */
export const GIT_ISOLATION_ITEMS = [
  { id: "off", label: "off", help: "tasks work in the folder you started them in" },
  { id: "branch", label: "branch", help: "each new task gets a git branch named after it, checked out in the working folder" },
  { id: "worktree", label: "worktree", help: "each new task gets its own worktree and branch, named after it: every agent runs there, apart from your checkout" },
] as const
export const GIT_LABEL = "Git isolation"

/** The lint gate's modes (`LINT_MODES`). */
export const LINT_MODE_ITEMS = [
  { id: "off", label: "off", help: "agents' work is never linted" },
  { id: "advise", label: "advise", help: "the oracle and QA are told what the project's linter finds on the lines a task changed; nothing is held" },
  { id: "block", label: "block", help: "new lint errors also hold a task's completion until they are fixed, or you accept the work as it is" },
] as const

export const LINT = {
  intro: "After every worker step, before QA and at completion, bot-lobby lints only the files the task's agents touched. Problems on the lines the task changed are the task's; anything already there is shown but never holds it. Suppressions and lint-config changes the task adds go to QA to judge.",
  mode: "Lint gate",
  command: "Command",
  commandHelp: "empty runs the linters the project configures (ESLint, Biome, Oxlint, Ruff), each from its own folder; a command runs without a shell from the repository's top, with {files} standing for the touched files",
  commandPlaceholder: "found from the project",
  extensions: "File types",
  extensionsHelp: "which touched files the command is given, such as .ts .tsx .py",
  extensionsPlaceholder: "every touched file",
  timeout: "Time limit",
  timeoutHelp: "for one linter run; one that runs over reads as could not run, and holds nothing",
  found: "Found in this project",
  foundHelp: "config files in the project and the folders a few levels below it",
  foundNone: "No linter config found. Add one to the project, or set a command above.",
  foundReplaced: "The command replaces these.",
  installed: "installed",
  missing: "not installed",
  missingHelp: "install the project's dependencies there, or lint cannot run",
  top: "project root",
} as const

/** The classifier hosts. */
export const JEV_HOST_ITEMS = [
  { id: "auto", label: "Auto (OpenCode's free Jev, else TypeSafe)" },
  { id: "opencode", label: "OpenCode Zen" },
  { id: "typesafe", label: "TypeSafe" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "vercel", label: "Vercel AI Gateway" },
] as const

/** The classifier's decisions, each its own switch. */
export const CLASSIFIER_FEATURE_ITEMS = [
  { id: "seats", label: "Planning seats", help: "each round, only the seats your idea or latest answers touch sit; 1-4 in the Plan tab pins one" },
  { id: "answers", label: "Obvious answers", help: "a panel question whose recommended option the conversation already makes clearly right is answered for you (listed under Assumptions)" },
  { id: "triage", label: "Task triage", help: "a new task's size, domains and research need reach the Master as hints; a quick fix that is really a task is held for you" },
  { id: "effort", label: "Effort routing", help: "a simple step runs one thinking level lower, a trivial one on the cheaper model below; a routed run that falls short runs again on your settings" },
  { id: "qa", label: "QA risk", help: "once a task's work is in, Jev reads the diff and sizes QA to it: no QA agent for a change with nothing that runs, a light check for a small one, deep review where a defect would spread; with it off the engine's rules decide" },
  { id: "review", label: "Pull request read", help: "the Git tab's quick read of a pull request: its size, and how likely it is risky, security-relevant, breaking or untested, before an agent reviews it" },
  { id: "knowledge", label: "Relevant knowledge", help: "when an agent's knowledge, standards or decisions file is too long for its prompt, Jev picks the sections that bear on the step, and the agent is told where the rest is" },
  { id: "files", label: "File hints", help: "scouts, workers, quick fixes and the planning panel start with the files most likely needed, and can look more up with find_relevant_files" },
] as const

export const CLASSIFIER_LABELS = {
  enabled: "Classifier",
  enabledHelp: "Jev makes the obvious decisions so large models spend fewer tokens on them",
  host: "Host",
  model: "Model",
  modelHelp: "empty uses the host's default",
  key: "API key",
  keyNote: "the key pi already holds for this host; it is never read by this page",
  cheap: "Cheaper model",
  cheapNone: "none: trivial steps keep their model and drop a thinking level",
  cheapHelp: "what effort routing runs trivial steps on",
} as const

/** Page-only copy: the headings, hints and confirmations. */
export const PAGE = {
  title: "Settings",
  intro: "Each agent's model and effort, the workflow and its lint gate, the lobby and the classifier. Changes save as you make them.",
  loading: "Loading settings…",
  loadFailed: "Could not load settings.",
  saved: "Settings saved",
  saving: "Saving…",
  appearanceHelp: "Light, dark, or follow your system. Kept in this browser only.",
  themeLabel: "Mode",
  themeItems: [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
  ] as const,
  notificationsLabel: "Browser notifications",
  notificationsHelp: "While this page is hidden, tell me when a question waits, a task finishes or a background session asks something.",
  notificationsBlocked: "Notifications are blocked in your browser. Allow them for this site and try again.",
  notificationsUnsupported: "This browser does not offer notifications.",
  notificationsOn: "Browser notifications are on.",
  notificationsOff: "Browser notifications are off.",
  installLabel: "Install bot-lobby",
  installHelp: "Opens in its own fullscreen window, with the shell cached so it starts when Pi is not running.",
  installButton: "Install as fullscreen app",
  installUnavailable: "Your browser has not offered to install it. Use its menu: “Install app” (Chrome, Edge) or Share, then “Add to Home Screen” (Safari).",
  installDone: "bot-lobby is installed.",
  installedNow: "Running as an installed app.",
  fullscreenLabel: "Fullscreen",
  fullscreenHelp: "Hide the browser's own bars for this tab (F11 does the same).",
  fullscreenOn: "Exit fullscreen",
  fullscreenOff: "Go fullscreen",
} as const
