/**
 * Sounds, under Appearance: the master switch, the volume (a number box, 0 to 100) and one row per
 * moment with a play button to hear it and its own switch. All kept in this browser.
 */
import { useEffect, useState } from "react"
import { Play } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ActionButton } from "@/ui/Actions"
import { SOUNDS, playSound, setSoundMuted, setSoundOn, setSoundVolume, soundOn, useSoundMuted, useSoundSwitches, useSoundVolume } from "@/app/sound"
import { Field } from "./parts"

function VolumeBox({ disabled }: { disabled: boolean }) {
  const volume = useSoundVolume()
  const [text, setText] = useState(String(volume))
  useEffect(() => setText(String(volume)), [volume])
  const commit = () => {
    const value = Number(text.trim())
    if (text.trim() === "" || !Number.isFinite(value)) return setText(String(volume))
    setSoundVolume(value)
    setText(String(Math.min(100, Math.max(0, Math.round(value)))))
  }
  return (
    <div className="relative">
      <Input type="number" inputMode="numeric" min={0} max={100} step={5} value={text} disabled={disabled} aria-label="Sound volume" className="pr-10" onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">%</span>
    </div>
  )
}

export function SoundFields() {
  const muted = useSoundMuted()
  useSoundSwitches()
  return (
    <>
      <Field label="Sounds" help="A short sound when something needs you. Kept in this browser; sound starts after your first click. Desktop notifications are separate.">
        <Switch checked={!muted} onCheckedChange={(on) => setSoundMuted(!on)} aria-label="Sounds" />
      </Field>
      <Field label="Volume" help="0 to 100. The play buttons below use it too.">
        <VolumeBox disabled={muted} />
      </Field>
      {SOUNDS.map((sound) => (
        <Field key={sound.kind} label={sound.label} help={sound.help}>
          <div className="flex items-center justify-end gap-2">
            <ActionButton iconOnly icon={Play} label={`Play ${sound.label.toLowerCase()} sound`} onClick={() => playSound(sound.kind, { preview: true })} />
            <Switch checked={soundOn(sound.kind)} disabled={muted} onCheckedChange={(on) => setSoundOn(sound.kind, on)} aria-label={`${sound.label} sound`} />
          </div>
        </Field>
      ))}
    </>
  )
}
