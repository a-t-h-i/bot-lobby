// Adapted from T3 Code (MIT), apps/web/src/components/ui/combobox.tsx
/**
 * A drop-down with a search box: the trigger shows the chosen option, the
 * list opens under it with a field that filters as you type. Keyboard first:
 * Enter, Space or Down on the trigger opens it; typing filters; Up/Down move,
 * Enter picks, Esc closes and gives focus back to the trigger.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/reui/popover"
import { ChevronDown, Search } from "lucide-react"
import { SELECT_CHEVRON, SELECT_FIELD } from "@/components/reui/select"
import { cn } from "@/lib/utils"

export interface ComboOption {
  value: string
  label: string
  /** A second line under the label, searched too. */
  hint?: string
  /** A short word beside the label in the trigger once chosen (`Recommended`). */
  tag?: string
  /** Shown and named, but never chosen: the keyboard and the pointer leave it alone. */
  disabled?: boolean
}

interface ComboboxProps {
  value: string
  options: readonly ComboOption[]
  onChange: (value: string) => void
  /** The trigger's accessible name. */
  label: string
  className?: string
  disabled?: boolean
}

function matches(option: ComboOption, query: string): boolean {
  const text = `${option.label} ${option.hint ?? ""} ${option.value}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

/** The first option from `from` (inclusive) stepping by `step` that can be chosen, else `fallback`. */
function enabledFrom(shown: readonly ComboOption[], from: number, step: 1 | -1, fallback: number): number {
  for (let i = from; i >= 0 && i < shown.length; i += step) if (!shown[i]!.disabled) return i
  return fallback
}

/** The first option that can be chosen, or 0 when none can. */
function firstEnabled(shown: readonly ComboOption[]): number {
  return enabledFrom(shown, 0, 1, 0)
}

export function Combobox({ value, options, onChange, label, className, disabled }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const shown = useMemo(() => options.filter((option) => matches(option, query)), [options, query])
  const chosen = options.find((option) => option.value === value)

  // Each opening starts clean, on the chosen option (or the first one that can be chosen).
  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(enabledFrom(options, Math.max(0, options.findIndex((option) => option.value === value)), 1, firstEnabled(options)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Typing narrows the list; the first option that can be chosen becomes active.
  function search(next: string) {
    setQuery(next)
    setActive(firstEnabled(options.filter((option) => matches(option, next))))
  }

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, open, shown.length])

  function pick(option: ComboOption | undefined) {
    if (!option || option.disabled) return
    setOpen(false)
    if (option.value !== value) onChange(option.value)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((now) => enabledFrom(shown, Math.min(shown.length - 1, now + 1), -1, now))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((now) => enabledFrom(shown, Math.max(0, now - 1), 1, now))
    } else if (event.key === "Home" && !query) {
      event.preventDefault()
      setActive(firstEnabled(shown))
    } else if (event.key === "End" && !query) {
      event.preventDefault()
      setActive(enabledFrom(shown, shown.length - 1, -1, 0))
    } else if (event.key === "Tab") {
      // Leaving the field closes the list; focus goes back to the trigger.
      setOpen(false)
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      pick(shown[active])
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        role="combobox"
        aria-label={label}
        aria-keyshortcuts="Enter Space ArrowDown ArrowUp"
        aria-description="When focused, press Enter, Space or an arrow key to choose. Type to search."
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onKeyDown={(event) => {
          // Down or Up opens the list, like a native select.
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            setOpen(true)
          }
        }}
        data-slot="select-trigger"
        className={cn(
          SELECT_FIELD,
          "w-full min-w-0 overflow-hidden whitespace-nowrap",
          className
        )}
      >
        <span className="min-w-0 truncate">{chosen?.label ?? value}</span>
        {chosen?.tag ? <span className="cs-rec">{chosen.tag}</span> : null}
        <ChevronDown aria-hidden="true" strokeWidth={2.25} className={SELECT_CHEVRON} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).querySelector<HTMLElement>("input")?.focus()
        }}
        className="p-0 flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),17rem)] max-w-(--radix-popover-content-available-width) flex-col overflow-hidden rounded-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-2.5">
          <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={onKeyDown}
            role="searchbox"
            aria-label={`Search ${label}`}
            aria-controls={id}
            aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
            placeholder="Search…"
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={list} id={id} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto p-1">
          {shown.length === 0 ? <p className="px-2.5 py-2 text-xs text-muted-foreground">Nothing matches “{query}”.</p> : null}
          {shown.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-index={index}
              data-disabled={option.disabled || undefined}
              onPointerMove={() => {
                if (!option.disabled) setActive(index)
              }}
              onClick={() => pick(option)}
              className={cn(
                "flex min-h-8 items-center gap-2 rounded-sm px-2 py-1 text-sm select-none sm:min-h-7",
                option.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                !option.disabled && option.value === value && "bg-foreground/[0.08]",
                !option.disabled && index === active && "bg-accent text-accent-foreground"
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{option.label}</span>
                {option.hint ? <span className="line-clamp-2 text-pretty text-xs text-muted-foreground/80">{option.hint}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
