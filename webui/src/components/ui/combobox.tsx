/**
 * A drop-down with a search box: the trigger shows the chosen option, the
 * list opens under it with a field that filters as you type. Keyboard first:
 * Enter, Space or Down on the trigger opens it; typing filters; Up/Down move,
 * Enter picks, Esc closes and gives focus back to the trigger.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Popover } from "radix-ui"
import { Check, ChevronDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ComboOption {
  value: string
  label: string
  /** A second line under the label, searched too. */
  hint?: string
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

export function Combobox({ value, options, onChange, label, className, disabled }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const shown = useMemo(() => options.filter((option) => matches(option, query)), [options, query])
  const chosen = options.find((option) => option.value === value)

  // Each opening starts clean, on the chosen option.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Typing narrows the list; the first match is active.
  useEffect(() => {
    if (query) setActive(0)
  }, [query])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, open, shown.length])

  function pick(option: ComboOption | undefined) {
    if (!option) return
    setOpen(false)
    if (option.value !== value) onChange(option.value)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((now) => Math.min(shown.length - 1, now + 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((now) => Math.max(0, now - 1))
    } else if (event.key === "Home" && !query) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === "End" && !query) {
      event.preventDefault()
      setActive(Math.max(0, shown.length - 1))
    } else if (event.key === "Tab") {
      // Leaving the field closes the list; focus goes back to the trigger.
      setOpen(false)
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      pick(shown[active])
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        role="combobox"
        aria-label={label}
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
          "flex h-8 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg border border-input bg-card/40 px-2.5 text-[0.8125rem] whitespace-nowrap outline-none transition-[border-color,box-shadow] duration-150 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
          className
        )}
      >
        <span className="min-w-0 truncate">{chosen?.label ?? value}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            ;(event.currentTarget as HTMLElement).querySelector<HTMLElement>("input")?.focus()
          }}
          className="glass-pop z-50 flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),17rem)] max-w-(--radix-popover-content-available-width) flex-col overflow-hidden rounded-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
        >
          <div className="flex items-center gap-2 border-b border-border px-2.5">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              role="searchbox"
              aria-label={`Search ${label}`}
              aria-controls={id}
              aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
              placeholder="Search…"
              autoComplete="off"
              spellCheck={false}
              className="h-8 min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground"
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
                data-index={index}
                onPointerMove={() => setActive(index)}
                onClick={() => pick(option)}
                className={cn("flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.8125rem] select-none", index === active && "bg-accent")}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.hint ? <span className="line-clamp-2 text-xs text-muted-foreground">{option.hint}</span> : null}
                </span>
                {option.value === value ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
