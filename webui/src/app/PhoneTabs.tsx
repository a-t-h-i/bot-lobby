import { useMemo, type CSSProperties } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useReducedMotion } from "motion/react"
import type { TabInfo } from "@protocol"
import { useAnyOverlay } from "@/lib/overlay"
import { usePhoneViewport } from "./usePhoneViewport"
import { availablePhoneTabs, pageLabel } from "./phoneCarousel"
import { PhonePeriods } from "./PhoneTabCards"
import { usePhoneCarousel } from "./usePhoneCarousel"

interface PhoneTabsProps {
  tabs: TabInfo[]
  activeId?: string
  onSelect: (id: string) => void
}

function currentPage(activeId: string | undefined, tabs: TabInfo[]): string {
  return pageLabel(activeId, tabs, window.location.hash)
}

export function PhoneTabs({ tabs: suppliedTabs, activeId, onSelect }: PhoneTabsProps) {
  const tabs = useMemo(() => availablePhoneTabs(suppliedTabs), [suppliedTabs])
  const blocked = useAnyOverlay()
  const { keyboardOpen } = usePhoneViewport()
  const reduced = Boolean(useReducedMotion())
  const label = currentPage(activeId, suppliedTabs)
  const carousel = usePhoneCarousel({ tabs, activeId, blocked, keyboardOpen, reduced, onSelect })

  if (!tabs.length) return null
  const collapsed = keyboardOpen && !carousel.peek
  return (
    <>
      <div aria-hidden={collapsed ? "true" : undefined} inert={collapsed} hidden={collapsed}>
        <PhoneCarouselView tabs={tabs} activeId={activeId} label={label} reduced={reduced} carousel={carousel} keyboardOpen={keyboardOpen} />
      </div>
      {collapsed ? <CollapsedHandle label={label} onOpen={() => carousel.setPeek(true)} /> : null}
    </>
  )
}

function CollapsedHandle({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <div className="phone-tabs phone-tabs-handle">
      <button type="button" data-phone-tabs-handle aria-expanded="false" aria-label={`Open tabs, current page ${label}`} onPointerDown={(event) => event.preventDefault()} onClick={onOpen} className="phone-tabs-current inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="truncate">{label}</span><ChevronUp aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

function PhoneCarouselView({ tabs, activeId, label, reduced, carousel, keyboardOpen }: { tabs: TabInfo[]; activeId?: string; label: string; reduced: boolean; carousel: ReturnType<typeof usePhoneCarousel>; keyboardOpen: boolean }) {
  return (
    <div className="phone-tabs" data-phone-tabs data-periods={carousel.periods}>
      {activeId && !tabs.some((tab) => tab.id === activeId) ? <span data-phone-page-handle className="phone-tabs-page-handle">{label}</span> : null}
      <div ref={carousel.scroller} className="phone-tabs-scroller" onScroll={carousel.onScroll} onPointerDown={carousel.onPointerDown} onPointerMove={carousel.onPointerMove} onPointerUp={carousel.onPointerUp} onPointerCancel={carousel.onPointerCancel} onClick={carousel.onSurfaceClick}>
        <div ref={carousel.track} className="phone-tabs-track" style={{ "--phone-period-pad": `${carousel.sidePad}px` } as CSSProperties} onKeyDown={carousel.onKeyDown}>
          <PhonePeriods tabs={tabs} activeId={activeId} reduced={reduced} onClick={carousel.onCardClick} canonicalRef={carousel.canonical} />
        </div>
      </div>
      {keyboardOpen && carousel.peek ? <button type="button" aria-label="Close tabs" onPointerDown={(event) => event.preventDefault()} onClick={() => carousel.setPeek(false)} className="phone-tabs-close"><ChevronDown aria-hidden="true" className="size-4" /></button> : null}
    </div>
  )
}
