/**
 * The lobby's sounds. Five moments each have one short sound, played from a small file in
 * `/sounds` (made by sound designers; see THIRD_PARTY_NOTICES.md):
 *
 * - question: an agent asks you something (KDE Ocean "dialog-question")
 * - attention: a background session asks, or work is ready for review (KDE Ocean "message-new-email")
 * - done: a task finishes (Android "NFCSuccess")
 * - error: something fails (Android "NFCFailure")
 * - sent: your message leaves the composer (elementary "audio-volume-change")
 *
 * Volume, the master mute and each sound's switch are page settings, kept in localStorage.
 * Nothing plays until the page has had a click or key press (browsers refuse earlier audio),
 * and nothing is queued to replay later. If a file cannot be loaded, a short synth tone stands in.
 */
import { useEffect, useSyncExternalStore } from "react"

export type SoundKind = "question" | "attention" | "done" | "error" | "sent"

export const SOUNDS: { kind: SoundKind; label: string; help: string }[] = [
  { kind: "question", label: "Question waiting", help: "An agent needs your answer." },
  { kind: "attention", label: "Needs a look", help: "A background session asks something, or work is ready for review." },
  { kind: "done", label: "Task finished", help: "A task completes." },
  { kind: "error", label: "Something failed", help: "An error, or a task is blocked or dropped." },
  { kind: "sent", label: "Message sent", help: "Your message leaves the composer." },
]

const FILES: Record<SoundKind, string> = {
  question: "/sounds/question.mp3",
  attention: "/sounds/attention.mp3",
  done: "/sounds/done.mp3",
  error: "/sounds/error.mp3",
  sent: "/sounds/sent.mp3",
}

const MUTED_KEY = "bot-lobby.prompt-sound-muted"
const VOLUME_KEY = "bot-lobby.sound-volume"
const OFF_KEY = "bot-lobby.sounds-off"
const DEFAULT_VOLUME = 60

const listeners = new Set<() => void>()
const memory: Record<string, string> = {}
let context: AudioContext | undefined
const buffers = new Map<SoundKind, Promise<AudioBuffer | undefined>>()

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return memory[key] ?? null }
}
function write(key: string, value: string): void {
  memory[key] = value
  try { localStorage.setItem(key, value) } catch { /* Browser-local memory still works. */ }
  for (const listener of [...listeners]) listener()
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

export function soundMuted(): boolean { return read(MUTED_KEY) === "on" }
export function setSoundMuted(muted: boolean): void { write(MUTED_KEY, muted ? "on" : "off") }
export function useSoundMuted(): boolean { return useSyncExternalStore(subscribe, soundMuted, () => false) }

/** Volume from 0 to 100. */
export function soundVolume(): number {
  const value = Number(read(VOLUME_KEY))
  return read(VOLUME_KEY) !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : DEFAULT_VOLUME
}
export function setSoundVolume(volume: number): void { write(VOLUME_KEY, String(Math.min(100, Math.max(0, Math.round(volume))))) }
export function useSoundVolume(): number { return useSyncExternalStore(subscribe, soundVolume, () => DEFAULT_VOLUME) }

function offList(): string { return read(OFF_KEY) ?? "" }
export function soundOn(kind: SoundKind): boolean { return !offList().split(",").includes(kind) }
export function setSoundOn(kind: SoundKind, on: boolean): void {
  const off = new Set(offList().split(",").filter(Boolean))
  if (on) off.delete(kind)
  else off.add(kind)
  write(OFF_KEY, [...off].join(","))
}
/** Re-renders when any sound's switch changes; read each with `soundOn`. */
export function useSoundSwitches(): string { return useSyncExternalStore(subscribe, offList, () => "") }

function unlock(): void {
  try {
    context ??= new AudioContext()
    void context.resume().catch(() => undefined)
    for (const { kind } of SOUNDS) void load(context, kind)
  } catch { /* Visual prompts remain authoritative. */ }
}

export function useSoundUnlock(): void {
  useEffect(() => {
    window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock)
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock) }
  }, [])
}

function load(audio: AudioContext, kind: SoundKind): Promise<AudioBuffer | undefined> {
  let pending = buffers.get(kind)
  if (!pending) {
    pending = (async () => {
      if (typeof audio.decodeAudioData !== "function") return undefined
      const response = await fetch(FILES[kind])
      if (!response.ok) return undefined
      return await audio.decodeAudioData(await response.arrayBuffer())
    })().catch(() => undefined)
    buffers.set(kind, pending)
  }
  return pending
}

/** A short falling sine tone, used when a file is not available. */
function tone(audio: AudioContext, level: number): void {
  const now = audio.currentTime, oscillator = audio.createOscillator(), gain = audio.createGain()
  oscillator.frequency.setValueAtTime(960, now); oscillator.frequency.exponentialRampToValueAtTime(360, now + 0.16)
  gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.2 * level), now + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
  oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now); oscillator.stop(now + 0.24)
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
}

async function sound(audio: AudioContext, kind: SoundKind, level: number): Promise<void> {
  const buffer = await load(audio, kind)
  if (!buffer) return tone(audio, level)
  const source = audio.createBufferSource(), gain = audio.createGain()
  source.buffer = buffer
  gain.gain.value = level
  source.connect(gain); gain.connect(audio.destination); source.start()
  source.onended = () => { source.disconnect(); gain.disconnect() }
}

/** Play one moment's sound, if sounds are on, that one is on, and the page may play audio. */
export function playSound(kind: SoundKind, options: { preview?: boolean } = {}): void {
  if (!options.preview && (soundMuted() || !soundOn(kind))) return
  if (options.preview) unlock()
  const audio = context
  if (!audio || (audio.state !== "running" && !options.preview)) return
  const level = soundVolume() / 100
  if (level <= 0) return
  void sound(audio, kind, level).catch(() => undefined)
}
