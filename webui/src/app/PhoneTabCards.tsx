import type { MouseEvent, ReactNode, Ref } from "react"
import { motion } from "motion/react"
import type { TabInfo } from "@protocol"
import { TabIcon } from "./TabIcons"
import { PHONE_PERIODS, tabNumber } from "./phoneCarousel"

const CARD_CLASS = "phone-tab-card inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/40"

export interface PhoneCardProps {
  tab: TabInfo
  selected: boolean
  canonical: boolean
  reduced: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  roving?: boolean
}

export interface PhonePeriodProps {
  tabs: TabInfo[]
  activeId?: string
  canonical: boolean
  reduced: boolean
  onClick: (id: string, event: MouseEvent<HTMLButtonElement>) => void
  canonicalRef?: Ref<HTMLDivElement>
}

export interface PhonePeriodsProps extends Omit<PhonePeriodProps, "canonical"> {}

function cardName(tab: TabInfo): string {
  const number = tabNumber(tab.key)
  return number ? `${number}. ${tab.label}` : tab.label
}

function cardContent(tab: TabInfo, selected: boolean): ReactNode {
  const number = tabNumber(tab.key)
  return (
    <>
      <TabIcon id={tab.id} play={selected ? 1 : 0} className="size-4 shrink-0" />
      {number ? <span aria-hidden="true" className="text-[0.7rem] font-semibold tabular-nums text-muted-foreground">{number}</span> : null}
      {selected ? <span className="max-w-[8.5rem] truncate">{tab.label}</span> : null}
    </>
  )
}

function cardTransition(reduced: boolean) {
  if (reduced) return { duration: 0 }
  return { type: "spring" as const, stiffness: 520, damping: 30, mass: 0.5 }
}

function CardVisual({ tab, selected, reduced }: Pick<PhoneCardProps, "tab" | "selected" | "reduced">) {
  return <motion.span className="inline-flex items-center gap-1.5" animate={{ scale: selected ? 1.04 : 1 }} transition={cardTransition(reduced)}>{cardContent(tab, selected)}</motion.span>
}

export function PhoneCard({ tab, selected, canonical, reduced, onClick, roving }: PhoneCardProps) {
  const label = cardName(tab)
  if (!canonical) return <span data-phone-tab-id={tab.id} data-active={selected ? "true" : "false"} className={CARD_CLASS} aria-hidden="true"><CardVisual tab={tab} selected={selected} reduced={reduced} /></span>
  return (
    <button type="button" role="tab" id={`tab-${tab.id}`} data-phone-tab-id={tab.id} aria-controls="main" aria-label={label} aria-keyshortcuts={tab.key} aria-selected={selected} tabIndex={selected || roving ? 0 : -1} onClick={onClick} className={CARD_CLASS}>
      <CardVisual tab={tab} selected={selected} reduced={reduced} />
    </button>
  )
}

export function PhonePeriod({ tabs, activeId, canonical, reduced, onClick, canonicalRef }: PhonePeriodProps) {
  const rovingId = activeId ?? tabs[0]?.id
  return (
    <div ref={canonical ? canonicalRef : undefined} data-phone-period={canonical ? "canonical" : "copy"} aria-hidden={!canonical || undefined} role={canonical ? "tablist" : undefined} aria-label={canonical ? "Lobby tabs" : undefined} className="phone-tabs-period">
      {tabs.map((tab) => <PhoneCard key={tab.id} tab={tab} selected={tab.id === activeId} canonical={canonical} reduced={reduced} roving={tab.id === rovingId} onClick={(event) => onClick(tab.id, event)} />)}
    </div>
  )
}

export function phonePeriodCount(tabCount: number): number {
  if (tabCount <= 0) return 0
  return tabCount === 1 ? 1 : PHONE_PERIODS
}

export function PhonePeriods({ tabs, activeId, reduced, onClick, canonicalRef }: PhonePeriodsProps) {
  const periods = phonePeriodCount(tabs.length)
  const canonicalIndex = Math.floor(periods / 2)
  if (!periods) return null
  return <>{Array.from({ length: periods }, (_, period) => <PhonePeriod key={period} tabs={tabs} activeId={activeId} canonical={period === canonicalIndex} reduced={reduced} onClick={onClick} canonicalRef={period === canonicalIndex ? canonicalRef : undefined} />)}</>
}
