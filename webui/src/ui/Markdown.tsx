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
  children?: HastNode[]
}

function hastText(node: HastNode | undefined): string {
  if (!node) return ""
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map((child) => hastText(child)).join("")
}

/** A fenced block with a Copy button reading the block's own text. */
function CodeBlock({ node, children }: { node?: unknown; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const text = hastText(node as HastNode | undefined)
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
    <div className="relative my-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={copy}
        disabled={!text}
        className="absolute top-2 right-2 z-10 h-10"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-24 text-sm leading-relaxed">{children}</pre>
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
    <div className="my-2 w-full overflow-x-auto">
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
