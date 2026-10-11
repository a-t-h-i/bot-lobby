import { useEffect, useState, type Dispatch, type SetStateAction } from "react"

interface ViewportState {
  keyboardOpen: boolean
  keyboardInset: number
}

interface ViewportSource {
  viewport: VisualViewport | null
  media: MediaQueryList | null
}

interface ViewportModel {
  phone: boolean
  baseline: number
  resetting: boolean
}

interface FrameRef {
  current?: number
}

type PublishState = Dispatch<SetStateAction<ViewportState>>

const CLOSED: ViewportState = { keyboardOpen: false, keyboardInset: 0 }
const PHONE_QUERY = "(max-width: 767.98px)"
const KEYBOARD_SHRINK = 100
const NON_EDITABLE_INPUTS = new Set([
  "button", "checkbox", "color", "date", "datetime-local", "file", "hidden", "image",
  "month", "radio", "range", "reset", "submit", "time", "week",
])

function isTextArea(element: Element | null): element is HTMLTextAreaElement {
  return typeof HTMLTextAreaElement !== "undefined" && element instanceof HTMLTextAreaElement
}

function isInput(element: Element | null): element is HTMLInputElement {
  return typeof HTMLInputElement !== "undefined" && element instanceof HTMLInputElement
}

function editableContent(element: Element | null): boolean {
  if (!(typeof HTMLElement !== "undefined" && element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const host = element.closest<HTMLElement>("[contenteditable]")
  return host !== null && host.getAttribute("contenteditable") !== "false"
}

function editable(element: Element | null): boolean {
  if (isTextArea(element)) return !element.disabled && !element.readOnly
  if (isInput(element)) return !element.disabled && !element.readOnly && !NON_EDITABLE_INPUTS.has(element.type)
  return editableContent(element)
}

function validHeight(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function layoutHeight(): number {
  return validHeight(window.innerHeight, 0)
}

function viewportHeight(viewport: VisualViewport | null): number {
  const layout = layoutHeight()
  return validHeight(viewport?.height ?? layout, layout)
}

function baselineHeight(viewport: VisualViewport | null): number {
  return Math.max(layoutHeight(), viewportHeight(viewport))
}

function phoneMatches(media: MediaQueryList | null): boolean {
  return media?.matches ?? window.innerWidth < 768
}

function viewportInset(viewport: VisualViewport | null, height: number, baseline: number): number {
  if (!viewport) return Math.max(0, baseline - height)
  const layout = layoutHeight() || baseline
  const offset = Number.isFinite(viewport.offsetTop) ? Math.max(0, viewport.offsetTop) : 0
  return Math.max(0, layout - height - offset)
}

function sameState(current: ViewportState, next: ViewportState): boolean {
  return current.keyboardOpen === next.keyboardOpen && current.keyboardInset === next.keyboardInset
}

function publish(setState: PublishState, next: ViewportState): void {
  setState((current) => sameState(current, next) ? current : next)
}

function createSource(): ViewportSource {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : null
  return { media, viewport: window.visualViewport ?? null }
}

function createModel(source: ViewportSource): ViewportModel {
  return { phone: phoneMatches(source.media), baseline: baselineHeight(source.viewport), resetting: false }
}

function inferredState(source: ViewportSource, model: ViewportModel, height: number): ViewportState {
  if (!model.phone || model.resetting || !editable(document.activeElement)) return CLOSED
  if (model.baseline - height < KEYBOARD_SHRINK) return CLOSED
  return { keyboardOpen: true, keyboardInset: viewportInset(source.viewport, height, model.baseline) }
}

function updateModel(source: ViewportSource, model: ViewportModel, setState: PublishState): void {
  const height = viewportHeight(source.viewport)
  const phone = phoneMatches(source.media)
  if (phone !== model.phone) {
    model.phone = phone
    model.baseline = baselineHeight(source.viewport)
    model.resetting = true
    publish(setState, CLOSED)
    return
  }
  if (!phone || model.resetting) {
    model.baseline = baselineHeight(source.viewport)
    model.resetting = false
    publish(setState, CLOSED)
    return
  }
  model.baseline = Math.max(model.baseline, baselineHeight(source.viewport))
  publish(setState, inferredState(source, model, height))
}

function resetModel(source: ViewportSource, model: ViewportModel, setState: PublishState): void {
  model.baseline = baselineHeight(source.viewport)
  model.resetting = true
  publish(setState, CLOSED)
}

function cancelFrame(frame: FrameRef): void {
  if (frame.current === undefined) return
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame.current)
  else window.clearTimeout(frame.current)
  frame.current = undefined
}

function scheduleFrame(update: () => void, frame: FrameRef): void {
  cancelFrame(frame)
  frame.current = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(update)
    : window.setTimeout(update, 0)
}

function listen(target: EventTarget | null, event: string, listener: () => void): () => void {
  if (!target) return () => {}
  target.addEventListener(event, listener)
  return () => target.removeEventListener(event, listener)
}

function attachListeners(
  source: ViewportSource,
  schedule: () => void,
  reset: () => void,
  breakpoint: () => void,
): (() => void)[] {
  return [
    listen(window, "focusin", schedule), listen(window, "focusout", schedule),
    listen(window, "resize", schedule), listen(window, "orientationchange", reset),
    listen(source.media, "change", breakpoint), listen(source.viewport, "resize", schedule),
    listen(source.viewport, "scroll", schedule),
  ]
}

function runUpdate(frame: FrameRef, source: ViewportSource, model: ViewportModel, setState: PublishState): void {
  frame.current = undefined
  updateModel(source, model, setState)
}

function resetViewport(source: ViewportSource, model: ViewportModel, setState: PublishState, schedule: () => void): void {
  resetModel(source, model, setState)
  schedule()
}

function markBreakpoint(source: ViewportSource, model: ViewportModel, setState: PublishState, schedule: () => void): void {
  model.phone = phoneMatches(source.media)
  resetModel(source, model, setState)
  schedule()
}

function disposeViewport(frame: FrameRef, cleanups: (() => void)[]): void {
  cancelFrame(frame)
  cleanups.forEach((cleanup) => cleanup())
}

function observeViewport(setState: PublishState): () => void {
  const source = createSource()
  const model = createModel(source)
  const frame: FrameRef = {}
  const update = () => runUpdate(frame, source, model, setState)
  const schedule = () => scheduleFrame(update, frame)
  const reset = () => resetViewport(source, model, setState, schedule)
  const breakpoint = () => markBreakpoint(source, model, setState, schedule)
  const cleanups = attachListeners(source, schedule, reset, breakpoint)
  schedule()
  return () => disposeViewport(frame, cleanups)
}

export function usePhoneViewport(): ViewportState {
  const [state, setState] = useState(CLOSED)
  useEffect(() => observeViewport(setState), [])
  return state
}
