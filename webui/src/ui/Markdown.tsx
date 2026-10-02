/**
 * Model text as real Markdown (D-10): `react-markdown` + `remark-gfm`, with
 * raw HTML never enabled (the raw-HTML rehype plugin is never imported).
 * Links are forced into a new tab with `rel="noopener noreferrer nofollow"`,
 * code blocks get a Copy button, and wide tables scroll inside their own box.
 * Memoised by text, so a streaming reply is the only Markdown redrawn on each
 * delta.
 */
import { memo, useCallback, useState, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { safeHref } from "@/lib/markdown"

interface HastNode {
  type?: string
  value?: string
  tagName?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

function hastText(node: HastNode | undefined): string {
  if (!node) return ""
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map((child) => hastText(child)).join("")
}

/** The fence's language (`language-ts` → `ts`), a plain word only. */
function langOf(node: HastNode | undefined): string {
  const names = node?.children?.find((child) => child.tagName === "code")?.properties?.className
  const name = (Array.isArray(names) ? names : []).map(String).find((value) => value.startsWith("language-"))
  const lang = name?.slice("language-".length) ?? ""
  return /^[\w+#.-]{1,20}$/.test(lang) ? lang : ""
}

/** A fenced block as Pi draws it (D-21): between its fences, the code indented and in the code-block colour; a Copy button reads the block's own text. */
function CodeBlock({ node, children }: { node?: unknown; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const text = hastText(node as HastNode | undefined)
  const lang = langOf(node as HastNode | undefined)
  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }, [text])

  return (
    <div className="relative my-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={copy}
        disabled={!text}
        className="absolute top-0 right-0 z-10 h-10 text-muted-foreground"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <pre className="overflow-x-auto pr-[12ch] text-sm leading-relaxed [&>code]:block [&>code]:pl-[2ch]">
        <span aria-hidden="true" className="block text-muted-foreground">
          {"```"}
          {lang}
        </span>
        {children}
        <span aria-hidden="true" className="block text-muted-foreground">
          {"```"}
        </span>
      </pre>
    </div>
  )
}

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  )
}

const components: Components = {
  pre: CodeBlock,
  a: Link,
  table: ({ children }) => (
    <div className="my-3 w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
}

/** Safe Markdown for untrusted model text; callers pass only `text` and `className`. */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md-body", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeHref} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
