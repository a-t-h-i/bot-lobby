/**
 * The settings page's copy. The group names, toggle labels, help lines and
 * value descriptions are the terminal settings menu's own words, quoted from
 * `src/pi/settings-ui.ts` and `src/pi/model-support.ts`; only the page's
 * headings, the appearance/notification/install rows and a handful of hints
 * are added here. Nothing secret is ever stored or shown.
 */

/** The menu's agent order (`SETTINGS_KINDS`): the master first, then every subagent. */
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

/** `kindLabel` from `src/pi/model-support.ts`, verbatim. */
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

/** Ideas for what each agent's free-form instructions do, shown as the field hint. */
export const FIELD_LABELS = {
  model: "Model",
  thinking: "Thinking",
  fallback: "Fallback model",
  fallbackThinking: "Fallback thinking",
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
export const NO_FALLBACK = "none"
export const NO_FALLBACK_HELP = "No fallback: when its model runs out of usage the run fails"
export const FIXED_SCOUT_THINKING = "low"
/** The levels the terminal accepts (`THINKING_LEVELS`); a model narrows them. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const

/** The settings menu order for agents on the page: master, subagents, then the shared groups. */
export const GROUP_TITLES = {
  agents: "Agents",
  workflow: "Workflow",
  lobby: "Lobby",
  classifier: "Classifier (Jev)",
  appearance: "Appearance",
  notifications: "Notifications",
  install: "Install as app",
} as const

/** `LOBBY_SWITCHES` from `src/pi/settings-ui.ts`, verbatim. `panel:*` are the Lobby tab's panes. */
export const LOBBY_SWITCH_ITEMS = [
  { id: "autoOpen", label: "Open with a task", help: "open the lobby when this session starts or resumes a task" },
  { id: "autoAsk", label: "Ask at once", help: "put the panel's questions to you as soon as a round ends, while the Plan tab is open" },
  { id: "mouse", label: "Mouse", help: "click tabs and draft lines, scroll with the wheel (shift+drag still selects text)" },
  { id: "miniLine", label: "Status line when hidden", help: "one line under the editor while the lobby is hidden: task steps, the planning round, a quick fix, or idle" },
  { id: "issues", label: "Issues tab", help: "the GitHub Issues tab" },
] as const

/** `PANEL_SWITCH_LABELS` and their shared help, verbatim. */
export const PANEL_ITEMS = [
  { id: "conversation", label: "Conversation pane" },
  { id: "activity", label: "Activity log pane" },
  { id: "thinking", label: "Thinking pane" },
] as const
export const PANEL_HELP = "shown on the Lobby tab; its key in the lobby toggles it too"

export const ROUNDS_LABEL = "Planning rounds"
export const ROUNDS_HELP = "enter cycles 2, 3, 5, 8, unlimited; the last round the oracle settles alone"
/** `PLANNING_ROUND_CHOICES`: 0 = unlimited. */
export const ROUND_CHOICES = [2, 3, 5, 8, 0] as const
export const SPLIT_LABEL = "Split long plans"
export const SPLIT_HELP = "saving a plan with more steps offers to split it into up to 5 tasks · enter cycles 6, 8, 10, 12, never"
/** `SPLIT_PLAN_CHOICES`: 0 = never. */
export const SPLIT_CHOICES = [6, 8, 10, 12, 0] as const

export const WEB_LABEL = "Web UI"
export const WEB_ENABLED_HELP = "start the loopback browser UI with /bot-lobby web"
export const WEB_PORT_LABEL = "Port"
export const WEB_PORT_HELP = "the base port (then the next free up to +20); 0 means any free port"
export const WEB_BROWSER_LABEL = "Open browser"
export const WEB_BROWSER_HELP = "open the link in the browser on /bot-lobby web"
export const WEB_QUESTIONS_LABEL = "Questions"
export const WEB_QUESTIONS_HELP = "where the web UI's questions are answered: both, or the terminal only"
export const WEB_QUESTIONS = ["both", "terminal"] as const

/** `GIT_ISOLATION_HELP` from `src/pi/settings-ui.ts`, verbatim. */
export const GIT_ISOLATION_ITEMS = [
  { id: "off", label: "off", help: "tasks work in the folder you started them in" },
  { id: "branch", label: "branch", help: "each new task gets a git branch named after it, checked out in the working folder" },
  { id: "worktree", label: "worktree", help: "each new task gets its own worktree and branch, named after it: every agent runs there, apart from your checkout" },
] as const
export const GIT_LABEL = "Git isolation"

/** `hostLabel` from `src/classifier/hosts.ts`, verbatim. */
export const JEV_HOST_ITEMS = [
  { id: "auto", label: "Auto (OpenCode's free Jev, else TypeSafe)" },
  { id: "opencode", label: "OpenCode Zen" },
  { id: "typesafe", label: "TypeSafe" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "vercel", label: "Vercel AI Gateway" },
] as const

/** `CLASSIFIER_FEATURE_ITEMS` from `src/pi/settings-ui.ts`, verbatim. */
export const CLASSIFIER_FEATURE_ITEMS = [
  { id: "seats", label: "Planning seats", help: "each round, only the seats your idea or latest answers touch sit; 1-4 in the Plan tab pins one" },
  { id: "answers", label: "Obvious answers", help: "a panel question whose recommended option the conversation already makes clearly right is answered for you (listed under Assumptions)" },
  { id: "triage", label: "Task triage", help: "a new task's size, domains and research need reach the Master as hints; a quick fix that is really a task is held for you" },
  { id: "effort", label: "Effort routing", help: "a simple step runs one thinking level lower, a trivial one on the cheaper model below; a routed run that falls short runs again on your settings" },
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
  intro: "Every setting the terminal's /bot-lobby settings menu writes, saved to the same config file.",
  loading: "Loading settings…",
  loadFailed: "Could not load settings.",
  saved: "Settings saved",
  saving: "Saving…",
  appearanceHelp: "The page's own light/dark theme; it is not sent to the server.",
  themeLabel: "Theme",
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
  installHelp: "Keep it in its own window, with the shell cached so it opens when Pi is not running.",
  installButton: "Install app",
  installUnavailable: "Use your browser's “Install app” or “Add to Home Screen” action.",
  installDone: "bot-lobby is installed.",
} as const

/** The terminal's success wording, for the toast after a save. */
export const SAVED_TO_CONFIG = "saved to the bot-lobby config"
