import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, type UIEvent } from "react"
import type { TabInfo } from "@protocol"
import { focusPage, tabWalk } from "@/prompts/nav"
import { navTick } from "./sound"
import { PHONE_COMMIT_MS, PHONE_PERIOD_GAP, PHONE_SETTLE_MS, seamScroll } from "./phoneCarousel"
import { phonePeriodCount } from "./PhoneTabCards"

interface Gesture {
  id: number
  x: number
  y: number
  moved: boolean
  originScrollLeft: number
  downTabId?: string
}

interface VisualCard {
  id: string
  element: HTMLElement
  distance: number
}

interface ClickGuard {
  kind: "committed" | "drag"
}

interface ProgrammaticScroll {
  value: number
  generation: number
}

export interface PhoneCarouselOptions {
  tabs: TabInfo[]
  activeId?: string
  blocked: boolean
  keyboardOpen: boolean
  reduced: boolean
  onSelect: (id: string) => void
}

export interface PhoneCarouselView {
  scroller: RefObject<HTMLDivElement | null>
  track: RefObject<HTMLDivElement | null>
  canonical: RefObject<HTMLDivElement | null>
  sidePad: number
  periods: number
  peek: boolean
  setPeek: (value: boolean) => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: () => void
  onSurfaceClick: (event: MouseEvent<HTMLDivElement>) => void
  onCardClick: (id: string, event: MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}

function clearTimer(timer: { current?: number }): void {
  if (timer.current !== undefined) window.clearTimeout(timer.current)
  timer.current = undefined
}

function closestTab(element: Element | null): string | undefined {
  return element?.closest<HTMLElement>("[data-phone-tab-id]")?.dataset.phoneTabId
}

function pressedTab(event: PointerEvent<HTMLDivElement>): string | undefined {
  return closestTab(event.target instanceof Element ? event.target : null)
}

function releasedTab(event: PointerEvent<HTMLDivElement>): string | undefined {
  const point = document.elementFromPoint(event.clientX, event.clientY)
  return closestTab(point) ?? closestTab(event.target instanceof Element ? event.target : null)
}

function cardDistance(element: HTMLElement, centre: number): VisualCard | undefined {
  const id = element.dataset.phoneTabId
  if (!id) return undefined
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.width)) return undefined
  return { id, element, distance: Math.abs(rect.left + rect.width / 2 - centre) }
}

function visualCards(track: HTMLElement, centre: number): VisualCard[] {
  return [...track.querySelectorAll<HTMLElement>("[data-phone-tab-id]")]
    .map((element) => cardDistance(element, centre))
    .filter((card): card is VisualCard => card !== undefined)
}

function nearestVisual(cards: VisualCard[]): VisualCard | undefined {
  return cards.reduce<VisualCard | undefined>((nearest, card) => !nearest || card.distance < nearest.distance ? card : nearest, undefined)
}

function candidateFor(scroller: HTMLElement, track: HTMLElement): VisualCard | undefined {
  const centre = scroller.getBoundingClientRect().left + scroller.clientWidth / 2
  return nearestVisual(visualCards(track, centre))
}

function canonicalCard(root: HTMLElement | null, id: string | undefined): HTMLElement | undefined {
  if (!root || !id) return undefined
  return [...root.querySelectorAll<HTMLElement>("[data-phone-tab-id]")].find((card) => card.dataset.phoneTabId === id)
}

function periodAdvance(period: HTMLElement): number {
  const gap = Number.parseFloat(getComputedStyle(period.parentElement ?? period).columnGap) || PHONE_PERIOD_GAP
  return period.offsetWidth + gap
}

function nextTab(key: string, current: string, tabs: TabInfo[]): string | undefined {
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === current))
  if (key === "Home") return tabs[0]?.id
  if (key === "End") return tabs.at(-1)?.id
  if (key === "ArrowRight") return tabs[(index + 1) % tabs.length]?.id
  if (key === "ArrowLeft") return tabs[(index - 1 + tabs.length) % tabs.length]?.id
  return undefined
}

function sameScroll(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= 2
}

function usePhoneCarouselRefs() {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const canonical = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | undefined>(undefined)
  const candidate = useRef<VisualCard | undefined>(undefined)
  const crossed = useRef<HTMLElement | undefined>(undefined)
  const settleTimer = useRef<number | undefined>(undefined)
  const commitTimer = useRef<number | undefined>(undefined)
  const clickGuard = useRef<ClickGuard | undefined>(undefined)
  const generation = useRef(0)
  const scrollGeneration = useRef(0)
  const programmatic = useRef<ProgrammaticScroll | undefined>(undefined)
  return useMemo(() => ({ scroller, track, canonical, gesture, candidate, crossed, settleTimer, commitTimer, clickGuard, generation, scrollGeneration, programmatic }), [])
}

type CarouselRefs = ReturnType<typeof usePhoneCarouselRefs>

function useCarouselTimers(refs: CarouselRefs) {
  const clearPending = useCallback(() => {
    clearTimer(refs.settleTimer)
    clearTimer(refs.commitTimer)
    refs.candidate.current = undefined
    refs.generation.current += 1
  }, [refs])
  return { clearPending }
}

function useCarouselCentering(refs: CarouselRefs) {
  const setProgrammatic = useCallback((value: number) => {
    const strip = refs.scroller.current
    if (!strip) return
    const generation = refs.scrollGeneration.current + 1
    refs.scrollGeneration.current = generation
    const pending = { value: Math.max(0, value), generation }
    refs.programmatic.current = pending
    strip.scrollLeft = pending.value
    pending.value = strip.scrollLeft
  }, [refs])
  const centre = useCallback((card: HTMLElement | undefined) => {
    const strip = refs.scroller.current
    if (!strip || !card || strip.clientWidth <= 0) return
    const stripRect = strip.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const value = strip.scrollLeft + cardRect.left + cardRect.width / 2 - (stripRect.left + strip.clientWidth / 2)
    setProgrammatic(value)
  }, [refs, setProgrammatic])
  const centreCanonical = useCallback((id: string | undefined) => {
    const card = canonicalCard(refs.canonical.current, id)
    if (card) refs.crossed.current = card
    centre(card)
  }, [centre, refs])
  const rebase = useCallback((strip: HTMLElement, period: HTMLElement) => {
    const corrected = seamScroll(strip.scrollLeft, periodAdvance(period))
    if (sameScroll(corrected, strip.scrollLeft)) return false
    const delta = corrected - strip.scrollLeft
    if (refs.gesture.current) refs.gesture.current.originScrollLeft += delta
    setProgrammatic(corrected)
    return true
  }, [refs, setProgrammatic])
  return { centre, centreCanonical, rebase }
}

function useCarouselClicks(refs: CarouselRefs) {
  const clearGuard = useCallback(() => {
    refs.clickGuard.current = undefined
  }, [refs])
  const guardClick = useCallback((kind: ClickGuard["kind"]) => {
    clearGuard()
    refs.clickGuard.current = { kind }
  }, [clearGuard, refs])
  const consumeGuard = useCallback((pointerClick: boolean) => {
    if (!pointerClick || !refs.clickGuard.current) return false
    clearGuard()
    return true
  }, [clearGuard, refs])
  return { clearGuard, guardClick, consumeGuard }
}

function useCandidateMarker(refs: CarouselRefs) {
  return useCallback(() => {
    const strip = refs.scroller.current
    const track = refs.track.current
    if (!strip || !track) return undefined
    const next = candidateFor(strip, track)
    if (next && next.element !== refs.crossed.current) {
      refs.crossed.current = next.element
      navTick()
    }
    refs.candidate.current = next
    return next
  }, [refs])
}

function useCommitDelay(options: PhoneCarouselOptions, refs: CarouselRefs, clearPending: () => void, markCandidate: () => VisualCard | undefined, centre: (card: HTMLElement | undefined) => void) {
  const armCommit = useCallback((next: VisualCard | undefined, generation: number) => {
    if (!next || next.id === options.activeId) return
    clearTimer(refs.commitTimer)
    refs.commitTimer.current = window.setTimeout(() => {
      if (generation !== refs.generation.current || refs.candidate.current?.element !== next.element || options.blocked) return
      clearPending()
      options.onSelect(next.id)
    }, PHONE_COMMIT_MS)
  }, [clearPending, options, refs])
  const settle = useCallback(() => {
    clearTimer(refs.settleTimer)
    clearTimer(refs.commitTimer)
    const generation = ++refs.generation.current
    refs.settleTimer.current = window.setTimeout(() => {
      if (generation !== refs.generation.current || refs.gesture.current) return
      const next = markCandidate()
      if (!next) return
      centre(next.element)
      armCommit(next, generation)
    }, PHONE_SETTLE_MS)
  }, [armCommit, centre, markCandidate, refs])
  return settle
}

function useCarouselChoice(options: PhoneCarouselOptions, clearPending: () => void, centreCanonical: (id: string | undefined) => void) {
  return useCallback((id: string) => {
    if (!options.tabs.some((tab) => tab.id === id)) return false
    clearPending()
    options.onSelect(id)
    centreCanonical(id)
    return true
  }, [centreCanonical, clearPending, options])
}

function useUserScroll(refs: CarouselRefs, rebase: (strip: HTMLElement, period: HTMLElement) => boolean, markCandidate: () => VisualCard | undefined, settle: () => void) {
  return useCallback(() => {
    const strip = refs.scroller.current
    const period = refs.canonical.current
    if (!strip || !period) return
    const pending = refs.programmatic.current
    if (pending && pending.generation === refs.scrollGeneration.current && sameScroll(strip.scrollLeft, pending.value)) {
      refs.programmatic.current = undefined
      return
    }
    refs.programmatic.current = undefined
    clearTimer(refs.commitTimer)
    clearTimer(refs.settleTimer)
    refs.candidate.current = undefined
    refs.generation.current += 1
    if (rebase(strip, period)) {
      if (!refs.gesture.current) settle()
      return
    }
    markCandidate()
    if (!refs.gesture.current) settle()
  }, [markCandidate, rebase, refs, settle])
}

function useCarouselWheel(refs: CarouselRefs, clearPending: () => void, settle: () => void, enabled: boolean): void {
  const actions = useRef({ clearPending, settle })
  actions.current = { clearPending, settle }
  useEffect(() => {
    const strip = refs.scroller.current
    if (!enabled || !strip) return
    const listener = (event: WheelEvent) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0)
      if (!delta) return
      event.preventDefault()
      refs.programmatic.current = undefined
      actions.current.clearPending()
      strip.scrollLeft += delta
      actions.current.settle()
    }
    strip.addEventListener("wheel", listener, { passive: false })
    return () => strip.removeEventListener("wheel", listener)
  }, [enabled, refs])
}

function usePointerDown(refs: CarouselRefs, clearPending: () => void, clearGuard: () => void) {
  return useCallback((event: PointerEvent<HTMLDivElement>) => {
    clearPending()
    clearGuard()
    refs.programmatic.current = undefined
    refs.gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, originScrollLeft: event.currentTarget.scrollLeft, downTabId: pressedTab(event) }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [clearGuard, clearPending, refs])
}

function usePointerMove(refs: CarouselRefs, clearPending: () => void) {
  return useCallback((event: PointerEvent<HTMLDivElement>) => {
    const current = refs.gesture.current
    if (!current || current.id !== event.pointerId) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8) return
    current.moved = true
    clearPending()
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      event.currentTarget.scrollLeft = current.originScrollLeft + current.x - event.clientX
      event.preventDefault()
    }
  }, [clearPending, refs])
}

function usePointerUp(refs: CarouselRefs, choose: (id: string) => boolean, clicks: ReturnType<typeof useCarouselClicks>, settle: () => void) {
  return useCallback((event: PointerEvent<HTMLDivElement>) => {
    const current = refs.gesture.current
    if (!current || current.id !== event.pointerId) return
    refs.gesture.current = undefined
    const release = releasedTab(event)
    const down = current.downTabId
    const tap = Boolean(down && !current.moved && (!release || release === down))
    if (tap) {
      clicks.guardClick("committed")
      choose(down!)
      return
    }
    if (current.moved || (down && release && release !== down)) clicks.guardClick("drag")
    if (current.moved) settle()
  }, [choose, clicks, refs, settle])
}

function usePointerCancel(refs: CarouselRefs, clicks: ReturnType<typeof useCarouselClicks>, settle: () => void) {
  return useCallback(() => {
    const moved = refs.gesture.current?.moved
    refs.gesture.current = undefined
    if (moved) clicks.guardClick("drag")
    if (moved) settle()
  }, [clicks, refs, settle])
}

function usePhoneCarouselPointerHandlers(refs: CarouselRefs, choose: (id: string) => boolean, clicks: ReturnType<typeof useCarouselClicks>, settle: () => void, clearPending: () => void) {
  const onPointerDown = usePointerDown(refs, clearPending, clicks.clearGuard)
  const onPointerMove = usePointerMove(refs, clearPending)
  const onPointerUp = usePointerUp(refs, choose, clicks, settle)
  const onPointerCancel = usePointerCancel(refs, clicks, settle)
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

function useCardClick(choose: (id: string) => boolean, clicks: ReturnType<typeof useCarouselClicks>) {
  return useCallback((id: string, event: MouseEvent<HTMLButtonElement>) => {
    if (clicks.consumeGuard(event.detail !== 0)) return
    choose(id)
  }, [choose, clicks])
}

function useSurfaceClick(choose: (id: string) => boolean, clicks: ReturnType<typeof useCarouselClicks>) {
  return useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (clicks.consumeGuard(event.detail !== 0)) return
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-phone-tab-id]") : null
    if (!target || target.closest("button")) return
    const id = target.dataset.phoneTabId
    if (id) choose(id)
  }, [choose, clicks])
}

function useCarouselKeyboard(options: PhoneCarouselOptions, refs: CarouselRefs, choose: (id: string) => boolean) {
  return useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" && !event.altKey) {
      if (focusPage()) event.preventDefault()
      return
    }
    if (!options.tabs.length) return
    const current = (event.target as HTMLElement).closest<HTMLElement>("[role='tab']")?.dataset.phoneTabId ?? options.activeId ?? options.tabs[0].id
    const id = nextTab(event.key, current, options.tabs)
    if (id) {
      event.preventDefault()
      tabWalk.active = true
      tabWalk.to = id
      choose(id)
      canonicalCard(refs.canonical.current, id)?.focus({ preventScroll: true })
    } else if ((event.key === "Enter" || event.key === " ") && current) {
      event.preventDefault()
      choose(current)
    }
  }, [choose, options, refs])
}

function useCarouselLayout(refs: CarouselRefs) {
  const [sidePad, setSidePad] = useState(0)
  const [peek, setPeek] = useState(false)
  const updatePad = useCallback(() => {
    const strip = refs.scroller.current
    if (!strip || strip.clientWidth <= 0) return
    const next = Math.max(22, strip.clientWidth / 2)
    setSidePad((value) => Math.abs(value - next) < 0.5 ? value : next)
  }, [refs])
  return { sidePad, peek, setPeek, updatePad }
}

function centreActive(tabs: TabInfo[], activeId: string | undefined) {
  return tabs.find((tab) => tab.id === activeId)?.id ?? tabs[0]?.id
}

function useInitialCentre(options: PhoneCarouselOptions, centreCanonical: (id: string | undefined) => void, updatePad: () => void, visible: boolean) {
  const { activeId, keyboardOpen, tabs } = options
  useLayoutEffect(() => {
    updatePad()
    centreCanonical(centreActive(tabs, activeId))
  }, [activeId, centreCanonical, keyboardOpen, tabs, updatePad, visible])
}

function useResizeCentre(options: PhoneCarouselOptions, refs: CarouselRefs, clearPending: () => void, centreCanonical: (id: string | undefined) => void, updatePad: () => void) {
  const { activeId, tabs } = options
  useEffect(() => {
    const strip = refs.scroller.current
    if (!strip || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (strip.clientWidth <= 0) return
      clearPending()
      updatePad()
      centreCanonical(centreActive(tabs, activeId))
    })
    observer.observe(strip)
    if (refs.track.current) observer.observe(refs.track.current)
    return () => observer.disconnect()
  }, [activeId, centreCanonical, clearPending, refs, tabs, updatePad])
}

function useHashCancellation(clearPending: () => void) {
  useEffect(() => {
    const onHash = () => clearPending()
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [clearPending])
}

function useCarouselStateCancellation(options: PhoneCarouselOptions, refs: CarouselRefs, clearPending: () => void, tabIds: string) {
  useEffect(() => {
    clearPending()
    refs.crossed.current = undefined
  }, [clearPending, options.activeId, options.blocked, options.keyboardOpen, refs, tabIds])
}

function useCarouselUnmount(refs: CarouselRefs, clearPending: () => void, clearGuard: () => void) {
  useEffect(() => () => {
    clearPending()
    clearGuard()
    refs.programmatic.current = undefined
  }, [clearGuard, clearPending, refs])
}

function useCarouselPeek(options: PhoneCarouselOptions, clearPending: () => void, setPeek: (value: boolean) => void) {
  useEffect(() => {
    if (!options.keyboardOpen) setPeek(false)
    clearPending()
  }, [clearPending, options.blocked, options.keyboardOpen, setPeek])
}

export function usePhoneCarousel(options: PhoneCarouselOptions): PhoneCarouselView {
  const refs = usePhoneCarouselRefs()
  const { clearPending } = useCarouselTimers(refs)
  const centering = useCarouselCentering(refs)
  const clicks = useCarouselClicks(refs)
  const layout = useCarouselLayout(refs)
  const markCandidate = useCandidateMarker(refs)
  const settle = useCommitDelay(options, refs, clearPending, markCandidate, centering.centre)
  const choose = useCarouselChoice(options, clearPending, centering.centreCanonical)
  const userScroll = useUserScroll(refs, centering.rebase, markCandidate, settle)
  const handlers = usePhoneCarouselPointerHandlers(refs, choose, clicks, settle, clearPending)
  useCarouselWheel(refs, clearPending, settle, options.tabs.length > 0)
  const onKeyDown = useCarouselKeyboard(options, refs, choose)
  const onSurfaceClick = useSurfaceClick(choose, clicks)
  const onCardClick = useCardClick(choose, clicks)
  const tabIds = options.tabs.map((tab) => tab.id).join("\u0000")
  useInitialCentre(options, centering.centreCanonical, layout.updatePad, !options.keyboardOpen || layout.peek)
  useResizeCentre(options, refs, clearPending, centering.centreCanonical, layout.updatePad)
  useCarouselStateCancellation(options, refs, clearPending, tabIds)
  useHashCancellation(clearPending)
  useCarouselUnmount(refs, clearPending, clicks.clearGuard)
  useCarouselPeek(options, clearPending, layout.setPeek)
  return {
    scroller: refs.scroller,
    track: refs.track,
    canonical: refs.canonical,
    sidePad: layout.sidePad,
    periods: phonePeriodCount(options.tabs.length),
    peek: layout.peek,
    setPeek: layout.setPeek,
    onScroll: userScroll,
    ...handlers,
    onSurfaceClick,
    onCardClick,
    onKeyDown,
  }
}
