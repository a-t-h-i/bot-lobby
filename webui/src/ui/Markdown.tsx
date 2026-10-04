/**
 * Model text as real Markdown : `react-markdown` + `remark-gfm`, with
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
import { ActionButton } from "./Actions"
import { cn } from "@/lib/utils"
import { safeHref } from "@/lib/markdown"
import { projectUrl } from "@/lib/project"
import { AttachmentList, splitAttachments } from "./Attachments"

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

/** A fenced block: a soft card with its language and a Copy button that reads the block's own text. */
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
    <div className="relative my-3 rounded-lg bg-muted">
      <div className="flex items-center justify-between pl-3">
        <span className="text-xs text-muted-foreground">{lang || "code"}</span>
        <ActionButton label={copied ? "Copied" : "Copy the code"} icon={copied ? Check : Copy} className="size-7" onClick={copy} disabled={!text} />
      </div>
      <pre className="!my-0 overflow-x-auto !rounded-t-none !bg-transparent px-3 pb-3 text-sm leading-relaxed [&>code]:block">{children}</pre>
    </div>
  )
}

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href ? projectUrl(href) : undefined} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  )
}

const components: Components = {
  pre: CodeBlock,
  a: Link,
  img: ({ src, alt }) => <img src={src ? projectUrl(src) : undefined} alt={alt ?? ""} loading="lazy" />,
  table: ({ children }) => (
    <div className="my-3 w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
}

/** Safe Markdown for untrusted model text; callers pass only `text` and `className`. */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  const { body, files } = splitAttachments(text)
  return (
    <div className={cn("md-body", className)}>
      {body ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeHref} components={components}>
          {body}
        </ReactMarkdown>
      ) : null}
      <AttachmentList files={files} />
    </div>
  )
})
