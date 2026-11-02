/**
 * The linting wizard under the lint gate's settings, in two steps. Linters:
 * what the project configures and whether each is installed, with the command
 * that installs a missing one, and linters it could add, each step a command
 * typed into the page's own terminal (or a starter config written for it).
 * Rules: a short list of common rules per found linter, switched where that
 * linter reads them (its config file; ESLint's are the gate's `--rule` flags),
 * and the config itself opened in the code viewer for anything else. What the
 * linters find goes to QA and completion through the lint gate above.
 */
import { useState } from "react"
import { CircleAlert, CircleCheck, Copy, FileCode, FilePlus, Play, RefreshCw } from "lucide-react"
import type { LintSetup, LintSetupLinter, RuleChoice } from "@protocol"
import { Button } from "@/components/ui/button"
import { Frame, FramePanel } from "@/components/reui/frame"
import { call } from "@/lib/api"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useApiRead } from "@/app/useApiRead"
import { openCode } from "@/app/code/codeStore"
import { copyCommand, runInTerminal } from "@/app/runInTerminal"
import { Segmented } from "@/ui/Segmented"
import { tip } from "@/ui/TipLayer"
import { LINT, LINT_WIZARD as W } from "./words"

type Step = "linters" | "rules"

const where = (folder: string): string => (folder ? `${folder}/` : LINT.top)
const key = (linter: { tool: string; folder: string }) => `${linter.tool}:${linter.folder}`

/** A command as the page shows it, with Run (in the terminal) and Copy beside it. */
function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-accent px-2.5 py-1.5 font-mono text-xs" title={command}>{command}</code>
        <Button size="icon-sm" variant="ghost" aria-label={`${W.copy}: ${command}`} {...tip(W.copy)} onClick={() => void copyCommand(command)}><Copy /></Button>
        <Button size="sm" variant="outline" aria-label={`${W.run}: ${command}`} onClick={() => void runInTerminal(command)}><Play />{W.run}</Button>
      </div>
    </div>
  )
}

function Status({ installed }: { installed: boolean }) {
  return (
    <span title={installed ? undefined : LINT.missingHelp} className={cn("inline-flex shrink-0 items-center gap-1 text-xs", installed ? "text-success" : "text-warning")}>
      {installed ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleAlert aria-hidden="true" className="size-3.5" />}
      {installed ? LINT.installed : LINT.missing}
    </span>
  )
}

function LintersStep({ setup, replaced, onChange }: { setup: LintSetup; replaced: boolean; onChange: (next: LintSetup) => void }) {
  const create = async (name: string) => {
    try {
      onChange(await call("settings.lintCreate", { name }))
      toast.success(W.created(name))
      openCode(name)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : W.failed)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {replaced ? <p className="text-xs text-muted-foreground">{LINT.foundReplaced}</p> : null}
      {setup.linters.length === 0 ? <p className="text-sm text-muted-foreground">{W.noneFound}</p> : (
        <ul aria-label={LINT.found} className="flex flex-col divide-y divide-border [&>li]:py-3 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
          {setup.linters.map((linter) => (
            <li key={key(linter)} className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{linter.tool}</span>
                <span className="min-w-0 break-words text-xs text-muted-foreground">{where(linter.folder)}</span>
                <span className="flex-1" />
                <Status installed={linter.installed} />
              </div>
              {linter.install.map((command) => <CommandRow key={command} label={W.install} command={command} />)}
            </li>
          ))}
        </ul>
      )}
      {setup.offers.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[0.8125rem] font-medium">{setup.linters.length ? W.addAnother : W.add}</div>
            <p className="text-xs text-muted-foreground">{W.addHelp}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-[10px] border border-border [&>li]:p-3">
            {setup.offers.map((offer) => (
              <li key={offer.tool} className="flex min-w-0 flex-col gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{offer.tool}</span>
                  <p className="text-xs text-muted-foreground">{offer.blurb}</p>
                </div>
                {offer.steps.map((step, index) => step.command ? (
                  <CommandRow key={step.label} label={`${index + 1}. ${step.label}`} command={step.command} />
                ) : step.create ? (
                  <div key={step.label} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{`${index + 1}. ${step.label}`}</span>
                    <Button size="sm" variant="outline" onClick={() => void create(step.create!)}><FilePlus />{W.create}</Button>
                  </div>
                ) : null)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

const LEVEL_LABEL: Record<RuleChoice, string> = { default: "Default", off: "Off", warn: "Warn", error: "Error" }

function RulesStep({ setup, onChange }: { setup: LintSetup; onChange: (next: LintSetup) => void }) {
  const [picked, setPicked] = useState<string>()
  const [saving, setSaving] = useState<string>()
  const linter: LintSetupLinter | undefined = setup.linters.find((entry) => key(entry) === picked) ?? setup.linters[0]
  if (!linter) return <p className="text-sm text-muted-foreground">{W.noRules}</p>
  const editable = linter.rulesAt !== "read"
  const set = async (rule: string, level: RuleChoice) => {
    setSaving(rule)
    try {
      onChange(await call("settings.lintRule", { tool: linter.tool, folder: linter.folder, rule, level }))
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : W.failed)
    } finally {
      setSaving(undefined)
    }
  }
  const levels: RuleChoice[] = ["default", ...linter.levels]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {setup.linters.length > 1 ? (
          <Segmented label={W.which} value={key(linter)} onChange={setPicked} items={setup.linters.map((entry) => ({ id: key(entry), label: entry.folder ? `${entry.tool} · ${entry.folder}` : entry.tool }))} />
        ) : <span className="text-sm font-medium">{linter.tool} <span className="text-xs font-normal text-muted-foreground">{where(linter.folder)}</span></span>}
        <span className="flex-1" />
        {linter.config ? <Button size="sm" variant="ghost" onClick={() => openCode(linter.config)}><FileCode />{W.openConfig(linter.config)}</Button> : null}
      </div>
      <p className="text-xs text-muted-foreground">{linter.note ?? (linter.config ? W.writesTo(linter.config) : "")}</p>
      <ul aria-label={W.rulesOf(linter.tool)} className="flex flex-col divide-y divide-border [&>li]:py-2 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
        {linter.rules.map((rule) => (
          <li key={rule.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4", saving === rule.id && "opacity-60")}>
            <div className="min-w-0">
              <div className="text-[0.8125rem] font-medium">{rule.label}</div>
              <p className="break-words text-xs text-muted-foreground"><span className="font-mono">{rule.id}</span> · {rule.help}</p>
            </div>
            {editable ? (
              <Segmented label={`${rule.label} (${rule.id})`} value={rule.level} onChange={(level) => void set(rule.id, level)} items={levels.map((level) => ({ id: level, label: linter.levels.length === 2 && level === "error" ? "On" : LEVEL_LABEL[level] }))} />
            ) : <span className="text-xs text-muted-foreground">{LEVEL_LABEL[rule.level]}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LintWizard({ replaced }: { replaced: boolean }) {
  const read = useApiRead("settings.lintSetup", {}, ["status"])
  const [fresh, setFresh] = useState<LintSetup>()
  const [step, setStep] = useState<Step>("linters")
  // A switch answers with the whole setup, shown until Check again reads it afresh.
  const setup = fresh ?? read.data
  const reload = () => {
    setFresh(undefined)
    read.reload()
  }
  return (
    <Frame dense>
      <FramePanel className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[0.8125rem] font-medium">{W.title}</div>
            <p className="text-xs text-muted-foreground">{W.help}</p>
          </div>
          <Segmented label={W.title} value={step} onChange={setStep} items={[{ id: "linters", label: W.stepLinters }, { id: "rules", label: W.stepRules }]} />
          <Button size="icon-sm" variant="ghost" aria-label={W.recheck} {...tip(W.recheck)} onClick={reload}><RefreshCw className={cn(read.loading && "motion-safe:animate-spin")} /></Button>
        </div>
        {!setup ? (
          <p className="text-sm text-muted-foreground">{read.error ?? "Looking…"}</p>
        ) : step === "linters" ? (
          <LintersStep setup={setup} replaced={replaced} onChange={setFresh} />
        ) : (
          <RulesStep setup={setup} onChange={setFresh} />
        )}
      </FramePanel>
    </Frame>
  )
}
