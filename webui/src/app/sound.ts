import { useEffect, useSyncExternalStore } from "react"
const KEY = "bot-lobby.prompt-sound-muted"
const listeners = new Set<() => void>()
let context: AudioContext | undefined
let fallbackMuted = false
export function soundMuted(): boolean { try { return localStorage.getItem(KEY) === "on" } catch { return fallbackMuted } }
export function setSoundMuted(muted: boolean): void {
  fallbackMuted = muted
  try { localStorage.setItem(KEY, muted ? "on" : "off") } catch { /* Browser-local memory still works. */ }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useSoundMuted(): boolean { return useSyncExternalStore(subscribe, soundMuted, () => false) }

export function useSoundUnlock(): void {
  useEffect(() => {
    const unlock = () => {
      try { context ??= new AudioContext(); void context.resume().catch(() => undefined) } catch { /* Visual prompts remain authoritative. */ }
    }
    window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock)
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock) }
  }, [])
}

/** A short falling sine tone; no network assets and no replay queue after autoplay refusal. */
export function droplet(): void {
  if (soundMuted() || !context || context.state !== "running") return
  try {
    const now = context.currentTime, oscillator = context.createOscillator(), gain = context.createGain()
    oscillator.frequency.setValueAtTime(960, now); oscillator.frequency.exponentialRampToValueAtTime(360, now + 0.16)
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.12, now + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.24)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  } catch { /* Audio failure never blocks a prompt. */ }
}
