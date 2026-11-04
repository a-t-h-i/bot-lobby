# 10. Tasks

Goal: the Tasks page: list and detail side by side, with everything a task can ask of the person (approvals, resume, accept, force close, delivery review), comments, and messages to the task.

## Read first

- `webui/src/tabs/tasks/*` (all), `webui/src/ui/task-facts.tsx`, `webui/src/lib/phaseTiming.ts`, `webui/src/app/taskRoute.ts`.
- `src/webui/api/tasks.ts`, `src/webui/api/plans.ts`, `src/webui/protocol.ts` (`TaskRow`, `SnapshotTask`, `WorkClock`).

## Step 1. List (`views/tasks/list.js`)

- `tasks.list` (and `tasks.archived` when the Archived switch is on; never both at once). Grouped by section as today (check `TaskList.tsx` for the order and words).
- Row: state mark (working mark when running, `blocked` colour when waiting on you, tick when done), title (`taskTitles`), "3 / 7" progress, time. 36 px, one line.
- Wide pane (≥ 900 px, `on_size_change`): list is a 320 px column on the left, hairline divider (`border`), detail on the right. Narrow: list only; a row opens the detail in place with a back button.
- Saved plans (from `plans.get` for plan rows) appear as in today's list; their detail is `PlanDetail` (Step 3).
- Open task id kept in `setShared("bot-herdr/task", id)` so the Lobby's tasks card can open a task here (`layout.select pages tasks`).

## Step 2. Detail (`views/tasks/detail.js`)

From `tasks.get { id }`:

- Title + mark; facts row (state, id, track, branch, timing from `phaseTiming`).
- **Waiting on you** box at the top (`TaskInterventions.tsx`): each approval with Approve / Reject (`tasks.resolveApproval`), Resume (`tasks.resume`), Accept as is (`tasks.accept`), Force close (`tasks.forceClose`, needs the exact title typed). Every action asks first with herdr's `confirm` dialog; focus starts on Cancel.
- Request (Markdown), plan checklist (same checkbox look as the Lobby's tasks card), plan text (Markdown, folded).
- Skip step (`tasks.skipStep`) per step, as `SkipStep.tsx`.
- Delivery review (`DeliveryReview.tsx`): `tasks.deliveryReview` → files changed with links to the code view (phase 14), Deliver (`tasks.deliver`) / Later (`tasks.deliveryDefer`).
- Comments (`tasks.comments`, `tasks.comment`, `tasks.editComment`).
- Recent runs; "Open in session" (`tasks.open`), Auto on/off (`tasks.auto`), Archive / Restore / Delete.
- The composer (phase 08 `lib/composer.js`) at the bottom sends `tasks.message { id, text }` to the task's oracle (or a comment, as the web app's toggle decides).

## Done when

- `herdr-app check` passes.
- With a running task: progress moves live, an approval can be approved from herdr, a comment posts, a message reaches the task, Force close needs the title.
