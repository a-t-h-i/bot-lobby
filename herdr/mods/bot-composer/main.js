// Bot Lobby's composer for herdr: one text box for every agent herdr runs.
//
// It is Bot Lobby's composer (webui/src/app/Composer.tsx, docs/web-ui/composer-design) drawn in
// GPUI: one raised bubble with the text on top and a tools row under it (attach, the space chip,
// key hints, stop, a round send key). The `/` commands, the `@` agents, the attach menu and the
// spaces list grow out of its top edge as a smaller bubble joined to it by curved fillets.
//
// A message goes to the agent you were last in (the focused pane's, else the newest in the tab),
// or to whoever you `@`: a running agent, `@all` in this space, or `@new-<agent>` to start one in
// a new tab with the message. `/stop` and `/peek` act on the agent; any other `/command` is sent
// as typed, so each harness's own commands still work. Sending is `hc send` (paste, then Enter).
//
// The block it sits in only reserves the resting height: the bubble itself is drawn in a Popup
// anchored to the block's foot, so it can grow upward over the terminals as you type, the way
// the web app's floated over the chat. Props: { float: false } draws it inside the block instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Popup } from "gpui-base";
import {
  agents, spaces, focused, settings, run, hc, exec, knownAgents, pickFolder, home,
  props, nextCommand, notify, window as appWindow,
} from "herdr";
import { LIGHT, DARK, SIZE, MOTION, ICON, tint, textWidth } from "./look.js";
import {
  triggerAt, caretAfterEdit, slashRows, mentionRows, tokenFor, plan, defaultTarget, withoutEnter, messageText,
} from "./route.js";

const PLACEHOLDER = "Write a message, run a command, or ask an agent";
const CLEAR = "#00000000";

export default class BotComposer extends View {
  init(_props, cx) {
    this.text = "";
    this.trigger = null;
    this.dismissed = null; // the text Esc closed the suggestions on; they stay shut until it changes
    this.startOnly = false; // after /new: the @ list offers only agents to start
    this.pane = null; // "suggest" | "attach" | "spaces"
    this.at = 0;
    this.offset = 0; // first suggestion row shown when there are more than fit
    this.ready = false; // a pane's first frame is drawn closed, then opens, so it animates
    this.files = [];
    this.known = [];
    this.notice = null;
    this.sending = false;
    this.lastTarget = null;
    this.width = SIZE.maxWidth;
    this.hot = null; // the hovered tool, for its pressed-in look

    this.input = TextareaState.new({ rows: SIZE.minRows });
    this.input.set_auto_grow(SIZE.minRows, SIZE.maxRows);
    this.input.set_soft_wrap(true);
    this.input.on("change", (_e, cx) => this.changed(cx));
    // Enter is bound to our send action below; if the text box ever gets it first, it inserts a
    // newline and reports `submit`, and we send what was there before the newline.
    this.input.on("submit", (e, cx) => {
      if (e?.shift || e?.secondary) return;
      const before = this.text;
      const now = this.input.value();
      if (now === before) return;
      this.input.set_value(withoutEnter(now, before));
      this.text = this.input.value();
      if (this.menuOpen()) this.pick(this.rows()[this.at], cx);
      else this.send(cx);
    });
    this.input.on("paste_other", (_e, cx) => this.say("Images go in as files: drop them on the composer.", cx));

    // Keys while the text box has the keyboard. Later bindings win over the text box's own at
    // the same depth, and the menu ones are added last so they win over send.
    cx.bind_keys([
      { keystroke: "enter", action: "bot_composer_send", context: "BotComposer Input" },
      { keystroke: "enter", action: "bot_composer_pick", context: "BotComposerMenu Input" },
      { keystroke: "tab", action: "bot_composer_pick", context: "BotComposerMenu Input" },
      { keystroke: "up", action: "bot_composer_up", context: "BotComposerMenu Input" },
      { keystroke: "down", action: "bot_composer_down", context: "BotComposerMenu Input" },
      { keystroke: "escape", action: "bot_composer_close", context: "BotComposerPane" },
    ]);

    this.loadKnown(cx);
    cx.timer.every(60000, (cx) => this.loadKnown(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.input.focus();
        cx.notify();
      }
    });
  }

  loadKnown(cx) {
    cx.spawn(async (cx) => {
      try {
        this.known = await knownAgents({ on: this.space()?.machine ?? null });
      } catch {
        this.known = [];
      }
      cx.notify();
    });
  }

  // ── What is where ──────────────────────────────────────────────────────────────────────────

  space() {
    const f = focused();
    return spaces().find((s) => s.id === f?.space) ?? spaces().find((s) => s.active) ?? null;
  }

  target() {
    const list = agents();
    const t = defaultTarget(list, focused(), this.lastTarget);
    if (t) this.lastTarget = t;
    return list.find((a) => a.address === t) ?? null;
  }

  menuOpen() {
    return this.pane === "suggest" && this.rows().length > 0;
  }

  rows() {
    if (this.pane !== "suggest" || !this.trigger) return [];
    if (this.trigger.kind === "slash") return slashRows(this.trigger.query);
    return mentionRows(this.trigger.query, {
      agents: agents(),
      known: this.known,
      space: this.space()?.id ?? null,
      startOnly: this.startOnly,
    });
  }

  // ── Typing ─────────────────────────────────────────────────────────────────────────────────

  changed(cx) {
    const before = this.text;
    this.text = this.input.value();
    const caret = caretAfterEdit(before, this.text);
    const trigger = this.text === this.dismissed ? null : triggerAt(this.text, caret);
    if (!trigger || trigger.kind !== "mention") this.startOnly = this.startOnly && trigger?.kind === "mention";
    const was = this.pane;
    this.trigger = trigger;
    if (trigger) this.open("suggest", cx);
    else if (this.pane === "suggest") this.pane = null;
    else if (this.pane && this.text !== before) this.pane = null;
    if (this.pane === "suggest" && (was !== "suggest" || trigger?.query !== this.lastQuery)) {
      this.at = 0;
      this.offset = 0;
    }
    this.lastQuery = trigger?.query;
    if (this.text !== before) this.notice = null;
    cx.notify();
  }

  // A pane's first frame is drawn small and clear, then opens, so it grows the way the web app's did.
  open(pane, cx) {
    if (this.pane === pane) return;
    this.pane = pane;
    this.ready = false;
    cx.timer.after(16, (cx) => {
      this.ready = true;
      cx.notify();
    });
  }

  toggle(pane, cx) {
    if (this.pane === pane) this.pane = null;
    else this.open(pane, cx);
    this.input.focus();
    cx.notify();
  }

  close(cx) {
    if (this.pane === "suggest") this.dismissed = this.text;
    this.pane = null;
    this.startOnly = false;
    cx.notify();
  }

  move(by, cx) {
    const n = this.rows().length;
    if (!n) return;
    this.at = (this.at + by + n) % n;
    if (this.at < this.offset) this.offset = this.at;
    if (this.at >= this.offset + SIZE.rowsShown) this.offset = this.at - SIZE.rowsShown + 1;
    cx.notify();
  }

  pick(row, cx) {
    const t = this.trigger;
    if (!row || !t) return;
    const range = { start: t.start, end: t.end };
    if (row.kind === "command") {
      this.input.set_selected_range(range);
      if (row.name === "new") {
        this.startOnly = true;
        this.input.replace("@");
      } else {
        this.startOnly = false;
        this.input.replace(`/${row.name} `);
      }
    } else {
      this.startOnly = false;
      this.input.replace_range_with_token(range, tokenFor(row));
      this.input.replace(" ");
    }
    this.text = this.input.value();
    const caret = row.kind === "command" && row.name === "new" ? t.start + 1 : this.text.length;
    this.trigger = row.kind === "command" && row.name === "new" ? triggerAt(this.text, caret) : null;
    this.pane = this.trigger ? "suggest" : null;
    this.at = 0;
    this.offset = 0;
    this.input.focus();
    cx.notify();
  }

  say(text, cx, level = "info") {
    this.notice = { text, level };
    cx.notify();
    const shown = this.notice;
    cx.timer.after(5000, (cx) => {
      if (this.notice === shown) {
        this.notice = null;
        cx.notify();
      }
    });
  }

  // ── Files ──────────────────────────────────────────────────────────────────────────────────

  addFiles(paths, cx) {
    for (const path of paths) {
      if (!path || this.files.some((f) => f.path === path)) continue;
      this.files.push({ path, name: path.split(/[\\/]/).filter(Boolean).pop() ?? path });
    }
    this.pane = null;
    this.input.focus();
    cx.notify();
  }

  pickFiles(cx) {
    this.pane = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const os = appWindow().platform;
      const tries = os === "macos"
        ? [["osascript", ["-e", "set fs to choose file with multiple selections allowed", "-e", "set out to \"\"",
            "-e", "repeat with f in fs", "-e", "set out to out & POSIX path of f & linefeed", "-e", "end repeat", "-e", "out"]]]
        : os === "windows"
          ? [["powershell", ["-NoProfile", "-Command",
              "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; if ($d.ShowDialog() -eq 'OK') { $d.FileNames -join \"`n\" }"]]]
          : [["zenity", ["--file-selection", "--multiple", "--separator=\n"]], ["kdialog", ["--getopenfilename", home(), "--multiple", "--separate-output"]]];
      for (const [cmd, args] of tries) {
        try {
          const r = await exec(cmd, args, { timeout: 600000 });
          if (r.code === 0) this.addFiles(r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), cx);
          return;
        } catch {
          // not installed: try the next picker
        }
      }
      this.say("No file picker here. Drop files on the composer instead.", cx);
    });
  }

  pickFolderToAttach(cx) {
    this.pane = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Attach" });
      if (folder) this.addFiles([folder], cx);
    });
  }

  // ── Sending ────────────────────────────────────────────────────────────────────────────────

  send(cx) {
    if (this.sending) return;
    const content = this.input.content();
    const all = agents();
    const target = this.target();
    const result = plan(content, {
      agents: all,
      known: this.known,
      space: this.space()?.id ?? null,
      target: target?.address ?? null,
      files: this.files.map((f) => f.path),
    });
    if (result.error) return this.say(result.error, cx, "warning");
    if (!result.steps.length) return;
    const keptFiles = this.files;
    this.files = [];
    this.input.set_value("");
    this.text = "";
    this.pane = null;
    this.trigger = null;
    this.startOnly = false;
    this.dismissed = null;
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const failed = [];
      for (const step of result.steps) {
        try {
          await this.runStep(step, all);
        } catch (e) {
          failed.push(String(e?.message ?? e));
        }
      }
      this.sending = false;
      if (failed.length) {
        // Put the message back so nothing typed is lost.
        if (!this.input.value()) {
          this.input.set_value(content);
          this.text = this.input.value();
          this.files = keptFiles;
        }
        this.say(failed[0], cx, "error");
      }
      this.input.focus();
      cx.notify();
    });
  }

  async runStep(step, all) {
    const agent = all.find((a) => a.address === step.address);
    const name = agent?.program?.name ?? step.address;
    if (step.do === "peek") return run("terminal.peek", { terminal: step.address });
    if (step.do === "interrupt") {
      const r = await hc(["interrupt", step.address]);
      if (r.code !== 0) throw new Error(`Couldn't stop ${name}: ${(r.stderr || r.stdout).trim()}`);
      return;
    }
    if (step.do === "start") {
      run("tab.new", { argv: step.run, task: messageText(step.text, step.files), space: this.space()?.id });
      return;
    }
    // On another machine, files go over first (`hc put`), and the message names where they landed.
    let paths = step.files;
    if (step.address.includes("/") && paths.length) {
      paths = [];
      for (const f of step.files) {
        const r = await hc(["put", step.address, f]);
        if (r.code !== 0) throw new Error(`Couldn't copy ${f} to ${name}: ${(r.stderr || r.stdout).trim()}`);
        paths.push(r.stdout.trim().split(/\r?\n/).pop());
      }
    }
    const r = await hc(["send", step.address, messageText(step.text, paths)]);
    if (r.code !== 0) {
      const why = (r.stderr || r.stdout).trim();
      if (agent?.status === "blocked") throw new Error(`${name} is waiting for you. Answer it in its pane first.`);
      throw new Error(`Couldn't send to ${name}${why ? `: ${why}` : "."}`);
    }
  }

  stop(cx) {
    const t = this.target();
    if (!t) return;
    cx.spawn(async (cx) => {
      const r = await hc(["interrupt", t.address]);
      if (r.code !== 0) this.say(`Couldn't stop ${t.program?.name ?? t.address}.`, cx, "error");
      cx.notify();
    });
  }

  // ── Drawing ────────────────────────────────────────────────────────────────────────────────

  render(cx) {
    const c = settings().dark ? DARK : LIGHT;
    const width = Math.max(320, Math.min(SIZE.maxWidth, this.width - SIZE.gutter * 2));
    const bubble = this.bubble(c, width);
    const root = div()
      .id("bc-root")
      .size_full()
      .relative()
      .on_size_change((size, cx) => {
        const w = size.width / (settings().zoom ?? 1);
        if (Math.abs(w - this.width) > 0.5) {
          this.width = w;
          cx.notify();
        }
      });
    if (props()?.float === false) {
      return root.child(h_flex().size_full().items_end().justify_center().pb(SIZE.foot).child(bubble));
    }
    const anchor = div().id("bc-anchor").w_full().h(0);
    return root.child(
      div().absolute().left(0).right(0).bottom(SIZE.foot).h(0).child(
        Popup.new("bc-pop", anchor).anchor("bottom_center").content(bubble),
      ),
    );
  }

  bubble(c, width) {
    const contexts = ["BotComposer"];
    if (this.menuOpen()) contexts.push("BotComposerMenu");
    if (this.pane) contexts.push("BotComposerPane");
    const menu = this.paneView(c, width);
    return v_flex()
      .id("bc")
      .key_context(contexts.join(" "))
      .on_action("bot_composer_send", (_e, cx) => this.send(cx))
      .on_action("bot_composer_pick", (_e, cx) => this.pick(this.rows()[this.at], cx))
      .on_action("bot_composer_up", (_e, cx) => this.move(-1, cx))
      .on_action("bot_composer_down", (_e, cx) => this.move(1, cx))
      .on_action("bot_composer_close", (_e, cx) => this.close(cx))
      .flex_col_reverse()
      .items_center()
      .w(width)
      .text_color(c.ink)
      // Painted first, so the pane above (painted after) covers the box's top edge where they join.
      .child(this.box(c, width))
      .when(Boolean(menu), (el) => el.child(menu));
  }

  // The composer box: attachments, the text, the tools row.
  box(c, width) {
    const target = this.target();
    const busy = target?.status === "working";
    const empty = !this.text.trim() && !this.files.length;
    const placeholder = busy ? `${target.program?.name ?? "The agent"} is working. Enter steers it…` : PLACEHOLDER;
    return v_flex()
      .id("bc-box")
      .relative()
      .w(width)
      .bg(c.fill)
      .border_1()
      .border_color(c.edge)
      .rounded(SIZE.radius)
      .shadow_md()
      .on_drop((e, cx) => this.addFiles(e.paths, cx))
      .on_mouse_down("left", () => this.input.focus())
      // The bevel: a lit top edge inside the outline.
      .child(div().absolute().top(0).left(SIZE.radius).right(SIZE.radius).h(1).bg(c.rim))
      .when(this.files.length > 0, (el) => el.child(this.filesRow(c)))
      .child(
        div()
          .relative()
          .px(SIZE.textX)
          .pt(SIZE.textTop)
          .min_h(60)
          .when(!this.text, (el) =>
            el.child(div().absolute().top(SIZE.textTop).left(SIZE.textX).text_size(14).text_color(c.faint).child(placeholder)))
          .child(
            Textarea.new(this.input)
              .w_full()
              .bg(CLEAR)
              .border_0()
              .text_size(14)
              .line_height(21)
              .text_color(c.ink)
              .token((tok) => this.chip(c, tok.token))
              .on_token_click((ev, cx) => {
                this.input.set_selected_range(ev.range);
                cx.notify();
              }),
          ),
      )
      .child(this.tools(c, target, busy, empty));
  }

  chip(c, token) {
    const agent = token.id.startsWith("agent:") ? agents().find((a) => a.address === token.id.slice(6)) : null;
    const color = agent?.program?.tile ?? (token.id.startsWith("start:") ? c.muted : c.accent);
    return h_flex()
      .px(6)
      .h(20)
      .items_center()
      .rounded(6)
      .bg(c.hover)
      .border_1()
      .border_color(c.edge)
      .text_size(12.5)
      .font_medium()
      .text_color(color)
      .child(token.label ?? token.text);
  }

  filesRow(c) {
    return h_flex()
      .id("bc-files")
      .flex_wrap()
      .gap(6)
      .px(12)
      .pt(12)
      .children(this.files.map((f, i) =>
        h_flex()
          .id(`bc-file-${i}`)
          .h(28)
          .pl(8)
          .pr(4)
          .gap(6)
          .items_center()
          .rounded(SIZE.nested)
          .bg(c.hover)
          .border_1()
          .border_color(c.edge)
          .text_size(12)
          .child(svg(ICON("file")).size(14).text_color(c.muted))
          .child(div().max_w(220).truncate().child(f.name))
          .child(
            div()
              .id(`bc-file-x-${i}`)
              .size(20)
              .rounded(6)
              .flex()
              .items_center()
              .justify_center()
              .text_color(c.muted)
              .cursor_pointer()
              .hover((s) => s.bg(c.well).text_color(c.ink))
              .on_click((_e, cx) => {
                this.files.splice(i, 1);
                cx.notify();
              })
              .child(svg(ICON("x")).size(12)),
          )));
  }

  tools(c, target, busy, empty) {
    const kbd = (text) => div().px(5).py(1).rounded(5).bg(c.kbd).text_size(11).text_color(c.muted).child(text);
    const hints = this.menuOpen()
      ? [kbd("↑"), kbd("↓"), "choose", kbd("↵"), "insert"]
      : this.pane
        ? [kbd("Esc"), "close"]
        : [kbd("Shift"), kbd("↵"), "new line"];
    const space = this.space();
    const canSend = !empty && !this.sending;
    return h_flex()
      .id("bc-tools")
      .h(SIZE.tools)
      .px(10)
      .gap(6)
      .items_center()
      .child(this.iconButton(c, "bc-attach", "paperclip", this.pane === "attach", (_e, cx) => this.toggle("attach", cx)))
      .child(
        h_flex()
          .id("bc-space")
          .h(SIZE.chip)
          .px(8)
          .gap(6)
          .items_center()
          .rounded(SIZE.nested)
          .text_size(12.5)
          .text_color(c.muted)
          .cursor_pointer()
          .when(this.pane === "spaces", (el) => el.bg(c.well).text_color(c.ink))
          .hover((s) => s.bg(c.hover).text_color(c.ink))
          .on_click((_e, cx) => this.toggle("spaces", cx))
          .child(svg(ICON("folder")).size(14))
          .child(div().max_w(180).truncate().child(space?.name ?? "No space"))
          .when(Boolean(space?.branch), (el) => el.child(div().text_color(c.faint).max_w(120).truncate().child(space.branch)))
          .child(svg(ICON("chevron-down")).size(12).text_color(c.faint)),
      )
      .child(div().flex_1())
      .when(Boolean(this.notice), (el) =>
        el.child(div().max_w(320).truncate().text_size(12).text_color(this.notice.level === "error" ? c.danger : c.muted).child(this.notice.text)))
      .when(!this.notice && Boolean(target), (el) =>
        el.child(div().max_w(200).truncate().text_size(12).text_color(c.faint).child(`to ${target.program?.name ?? target.address}`)))
      .child(h_flex().gap(4).items_center().text_size(11.5).text_color(c.muted).children(hints))
      .when(busy, (el) =>
        el.child(
          div()
            .id("bc-stop")
            .size(SIZE.iconButton)
            .rounded_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(c.stop)
            .cursor_pointer()
            .hover((s) => s.bg(c.stopHover))
            .on_click((_e, cx) => this.stop(cx))
            .child(div().size(10).rounded(2).bg("#ffffff")),
        ))
      .child(
        div()
          .id("bc-send")
          .size(SIZE.iconButton)
          .rounded_full()
          .flex()
          .items_center()
          .justify_center()
          .when(canSend, (el) =>
            el.bg(c.accent).border_b(1).border_color(c.accentLip).text_color(c.accentInk).cursor_pointer().hover((s) => s.opacity(0.92)))
          .when(!canSend, (el) => el.bg(c.well).text_color(c.faint))
          .on_click((_e, cx) => this.send(cx))
          .child(this.sending
            ? svg(ICON("spinner")).size(16).spin(900)
            : svg(ICON("send")).size(16)),
      );
  }

  iconButton(c, id, icon, on, onClick) {
    return div()
      .id(id)
      .size(SIZE.iconButton)
      .rounded_full()
      .flex()
      .items_center()
      .justify_center()
      .text_color(on ? c.ink : c.muted)
      .cursor_pointer()
      .when(on, (el) => el.bg(c.well))
      .hover((s) => s.bg(c.well).text_color(c.ink))
      .on_click(onClick)
      .child(svg(ICON(icon)).size(16));
  }

  // ── The pane that grows out of the top ─────────────────────────────────────────────────────

  paneView(c, width) {
    if (!this.pane) return null;
    let size;
    let body;
    if (this.pane === "suggest") {
      const rows = this.rows();
      if (!rows.length) return null;
      const shown = rows.slice(this.offset, this.offset + SIZE.rowsShown);
      let w = 0;
      for (const r of rows) w = Math.max(w, textWidth(r.label && r.kind !== "command" ? r.label : r.name, 13) + textWidth(r.hint, 12.5) + textWidth(r.tag, 10.5));
      size = { w: Math.min(Math.max(Math.ceil(w) + 120, 220), width - 80), h: 12 + shown.length * SIZE.row };
      body = v_flex()
        .id("bc-rows")
        .w_full()
        .on_scroll_wheel((e, cx) => {
          const max = Math.max(0, rows.length - SIZE.rowsShown);
          const step = e.delta.y < 0 ? 1 : e.delta.y > 0 ? -1 : 0;
          this.offset = Math.max(0, Math.min(max, this.offset + step));
          cx.notify();
        })
        .children(shown.map((r, i) => this.row(c, r, this.offset + i, shown.length - 1 - i)));
    } else if (this.pane === "attach") {
      size = { w: 260, h: 12 + 3 * SIZE.row };
      body = v_flex()
        .w_full()
        .child(this.menuItem(c, "bc-attach-file", "file", "Attach document…", 2, (_e, cx) => this.pickFiles(cx)))
        .child(this.menuItem(c, "bc-attach-folder", "folder", "Attach folder…", 1, (_e, cx) => this.pickFolderToAttach(cx)))
        .child(h_flex().h(SIZE.row).px(8).items_center().text_size(11.5).text_color(c.muted).child("Or drop files on the composer"));
    } else {
      const list = spaces();
      const current = this.space()?.id;
      const shown = list.slice(0, 7);
      size = { w: 400, h: 12 + (shown.length + 1) * SIZE.row };
      body = v_flex()
        .w_full()
        .children(shown.map((s, i) =>
          h_flex()
            .id(`bc-sp-${s.id}`)
            .h(SIZE.row)
            .px(8)
            .gap(8)
            .items_center()
            .rounded(SIZE.nested)
            .cursor_pointer()
            .when(s.id === current, (el) => el.bg(c.hover))
            .hover((st) => st.bg(c.hover))
            .opacity(this.ready ? 1 : 0)
            .transition("opacity", { ...MOTION.row, delay: (shown.length - i) * MOTION.rowStagger })
            .on_click((_e, cx) => {
              run("space.select", { id: s.id });
              this.pane = null;
              this.input.focus();
              cx.notify();
            })
            .child(svg(ICON("folder")).size(14).text_color(c.muted))
            .child(div().text_size(13).font_medium().truncate().child(s.name))
            .when(Boolean(s.branch), (el) => el.child(div().text_size(12).text_color(c.faint).truncate().child(s.branch)))
            .child(div().flex_1())
            .when(Boolean(s.status), (el) => el.child(div().text_size(11).text_color(c.muted).child(s.status === "blocked" ? "needs you" : s.status)))))
        .child(this.menuItem(c, "bc-open-folder", "folder-plus", "Open folder…", 0, (_e, cx) => {
          this.pane = null;
          cx.notify();
          cx.spawn(async (cx) => {
            const folder = await pickFolder({ prompt: "Open" });
            if (folder) run("space.new", { folder });
            cx.notify();
          });
        }));
    }
    const h = this.ready ? size.h : Math.round(size.h * 0.85);
    const w = this.ready ? size.w : Math.round(size.w * 0.85);
    const pane = v_flex()
      .id("bc-pane")
      .w(w)
      .h(h)
      .transition("height", MOTION.menuHeight)
      .transition("width", MOTION.menuWidth)
      .bg(c.fill)
      .border_t(1)
      .border_l(1)
      .border_r(1)
      .border_color(c.edge)
      .rounded_t(SIZE.radius)
      .overflow_hidden()
      .px(SIZE.menuPad)
      .pt(8)
      .pb(SIZE.menuPad)
      .justify_end()
      .child(div().absolute().top(0).left(SIZE.radius).right(SIZE.radius).h(1).bg(c.rim))
      .child(body);
    // The joins: a concave curve each side, so the pane and the box read as one shape.
    const fillet = (side) =>
      div()
        .relative()
        .size(SIZE.fillet)
        .flex_none()
        .child(svg(ICON(`fillet-${side}`)).absolute().top(0).left(0).size(SIZE.fillet).text_color(c.fill))
        .child(svg(ICON(`fillet-${side}-edge`)).absolute().top(0).left(0).size(SIZE.fillet).text_color(c.edge));
    return h_flex()
      .id("bc-pane-row")
      .items_end()
      .mb(-1)
      .opacity(this.ready ? 1 : 0)
      .transition("opacity", { duration: 110, easing: "ease-out" })
      .child(fillet("left"))
      .child(pane)
      .child(fillet("right"));
  }

  row(c, r, index, fromBottom) {
    const active = index === this.at;
    const color = tint(c, r);
    const showName = r.kind === "command" ? r.name : r.label;
    return h_flex()
      .id(`bc-row-${r.id}`)
      .flex_none()
      .h(SIZE.row)
      .px(8)
      .gap(8)
      .items_center()
      .rounded(SIZE.nested)
      .cursor_pointer()
      .when(active, (el) => el.bg(c.hover))
      .hover((s) => s.bg(c.hover))
      .opacity(this.ready ? 1 : 0)
      .transition("opacity", { ...MOTION.row, delay: fromBottom * MOTION.rowStagger })
      .on_hover((hovered, cx) => {
        if (hovered && this.at !== index) {
          this.at = index;
          cx.notify();
        }
      })
      .on_click((_e, cx) => this.pick(r, cx))
      // Commands get a tile with their first letter; agents are named in their own colour, no dot.
      .when(r.kind === "command" || r.kind === "all", (el) =>
        el.child(
          div()
            .size(18)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(6)
            .border_1()
            .border_color(c.edge)
            .text_size(10.5)
            .font_semibold()
            .text_color(c.muted)
            .child(r.name.charAt(0).toUpperCase()),
        ))
      .child(div().flex_none().text_size(13).font_medium().text_color(r.kind === "command" ? c.ink : color).child(showName))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(c.muted).child(r.hint))
      .child(div().flex_none().px(5).rounded(5).text_size(10.5).font_medium().text_color(color).child(r.tag));
  }

  menuItem(c, id, icon, label, fromBottom, onClick) {
    return h_flex()
      .id(id)
      .flex_none()
      .h(SIZE.row)
      .px(8)
      .gap(8)
      .items_center()
      .rounded(SIZE.nested)
      .cursor_pointer()
      .hover((s) => s.bg(c.hover))
      .opacity(this.ready ? 1 : 0)
      .transition("opacity", { ...MOTION.row, delay: fromBottom * MOTION.rowStagger })
      .on_click(onClick)
      .child(svg(ICON(icon)).size(16).text_color(c.muted))
      .child(div().text_size(13).font_medium().child(label));
  }
}
