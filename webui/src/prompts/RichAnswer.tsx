/**
 * The questionnaire's own answer: a rich text field that is a slim pill until it has focus, then opens up into a
 * box with a small formatting bar (bold, italic, code, lists). What is typed goes out as Markdown, so the agent
 * reads the formatting the way it reads its own. Ctrl+B, Ctrl+I and Ctrl+E format from the keyboard; a paste
 * comes in as plain text. Enter answers (inside a list it starts the next item), Shift+Enter breaks the line, and
 * Up at the very start goes back to the options.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react"
import { Bold, Code, Italic, List, ListOrdered } from "lucide-react"
import { cn } from "@/lib/utils"

export interface RichAnswerHandle {
  element: HTMLDivElement | null
}

const ZERO_WIDTH = /​/g

/** The editor's content as Markdown. */
export function toMarkdown(root: Node): string {
  const blocks: string[] = []
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(ZERO_WIDTH, "")
    if (!(node instanceof HTMLElement)) return ""
    const inner = [...node.childNodes].map(inline).join("")
    const tag = node.tagName
    if (tag === "BR") return "\n"
    if (!inner.trim()) return inner
    if (tag === "B" || tag === "STRONG") return `**${inner}**`
    if (tag === "I" || tag === "EM") return `_${inner}_`
    if (tag === "CODE") return `\`${inner}\``
    if (tag === "UL" || tag === "OL") return `\n${list(node)}\n`
    if (tag === "DIV" || tag === "P" || tag === "LI") return `\n${inner}\n`
    return inner
  }
  const list = (node: HTMLElement): string =>
    [...node.children].filter((item) => item.tagName === "LI").map((item, at) => `${node.tagName === "OL" ? `${at + 1}.` : "-"} ${[...item.childNodes].map(inline).join("").trim()}`).join("\n")
  blocks.push([...root.childNodes].map(inline).join(""))
  return blocks.join("").replace(/\n{3,}/g, "\n\n").trim()
}

function caretAtStart(root: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset)
  return range.toString().replace(ZERO_WIDTH, "") === ""
}

function insideList(root: HTMLElement): boolean {
  const node = window.getSelection()?.anchorNode
  const element = node instanceof HTMLElement ? node : node?.parentElement
  return Boolean(element?.closest("li") && root.contains(element))
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char)
}

type Format = "bold" | "italic" | "code" | "insertUnorderedList" | "insertOrderedList"

function apply(format: Format) {
  if (format !== "code") {
    document.execCommand(format)
    return
  }
  const selection = window.getSelection()
  const text = selection?.toString() ?? ""
  document.execCommand("insertHTML", false, text ? `<code>${escapeHtml(text)}</code>` : "<code>​</code>")
}

const TOOLS: { format: Format; label: string; keys?: string; icon: typeof Bold }[] = [
  { format: "bold", label: "Bold", keys: "Ctrl+B", icon: Bold },
  { format: "italic", label: "Italic", keys: "Ctrl+I", icon: Italic },
  { format: "code", label: "Code", keys: "Ctrl+E", icon: Code },
  { format: "insertUnorderedList", label: "Bulleted list", icon: List },
  { format: "insertOrderedList", label: "Numbered list", icon: ListOrdered },
]

export const RichAnswer = forwardRef<RichAnswerHandle, {
  /** The field's HTML when it mounts (a question returned to), and "" to clear it. */
  html: string
  placeholder: string
  label: string
  /** Lit when the focus animation lands on the field. */
  landed?: boolean
  onChange: (markdown: string, html: string) => void
  onFocusChange: (focused: boolean) => void
  onSubmit: () => void
  onUp: () => void
}>(function RichAnswer({ html, placeholder, label, landed, onChange, onFocusChange, onSubmit, onUp }, handle) {
  const editor = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [empty, setEmpty] = useState(!html)
  const [active, setActive] = useState<Record<string, boolean>>({})
  useImperativeHandle(handle, () => ({ element: editor.current }), [])

  useEffect(() => {
    const el = editor.current
    if (!el) return
    if (html === "" && el.innerHTML !== "") {
      el.innerHTML = ""
      setEmpty(true)
    } else if (html && el.innerHTML === "") {
      el.innerHTML = html
      setEmpty(false)
    }
  }, [html])

  const sync = useCallback(() => {
    const el = editor.current
    if (!el) return
    const markdown = toMarkdown(el)
    setEmpty(markdown === "" && !el.querySelector("li"))
    onChange(markdown, markdown ? el.innerHTML : "")
  }, [onChange])

  // The bar shows which formats the caret is in.
  useEffect(() => {
    if (!focused) return
    const update = () => setActive(Object.fromEntries(TOOLS.filter((tool) => tool.format !== "code").map((tool) => [tool.format, document.queryCommandState(tool.format)])))
    document.addEventListener("selectionchange", update)
    update()
    return () => document.removeEventListener("selectionchange", update)
  }, [focused])

  function format(next: Format) {
    editor.current?.focus()
    apply(next)
    sync()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const el = editor.current
    if (!el) return
    const mod = event.ctrlKey || event.metaKey
    if (mod && !event.altKey && ["b", "i", "e"].includes(event.key.toLowerCase())) {
      event.preventDefault()
      event.stopPropagation()
      format(event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "i" ? "italic" : "code")
      return
    }
    if (event.key === "Enter" && !event.shiftKey && !mod && !event.nativeEvent.isComposing) {
      if (insideList(el)) return
      event.preventDefault()
      onSubmit()
      return
    }
    if (event.key === "ArrowUp" && caretAtStart(el)) {
      event.preventDefault()
      onUp()
    }
  }

  return (
    <div data-own="" data-open={focused || !empty || undefined} data-landed={landed || undefined} className="q-own group/own relative flex w-full min-w-0 flex-col overflow-hidden border">
      <div
        ref={editor}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        data-nav=""
        data-empty={empty || undefined}
        data-placeholder={placeholder}
        tabIndex={0}
        onInput={sync}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          event.preventDefault()
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"))
        }}
        onFocus={() => { setFocused(true); onFocusChange(true) }}
        onBlur={() => { setFocused(false); onFocusChange(false) }}
        className="q-own-text min-h-9 w-full min-w-0 px-4 py-2 text-sm break-words outline-none [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.8125rem] [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5"
      />
      <div role="toolbar" aria-label="Formatting" aria-hidden={!focused} className={cn("q-own-bar flex items-center gap-0.5 px-2 pb-1.5", !focused && "pointer-events-none")}>
        {TOOLS.map(({ format: name, label: toolLabel, keys, icon: Icon }) => (
          <button
            key={name}
            type="button"
            tabIndex={-1}
            aria-label={toolLabel}
            aria-pressed={active[name] ?? false}
            title={keys ? `${toolLabel} · ${keys}` : toolLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(name)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-primary/12 aria-pressed:text-primary"
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        ))}
        <span className="ms-auto pe-1 text-2xs text-muted-foreground">Enter answers · Shift+Enter new line</span>
      </div>
    </div>
  )
})
