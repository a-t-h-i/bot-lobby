/** Safe Markdown; only explicit question payloads are interpreted as HTML mockups. */
import { memo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"
import { ActionButton } from "./Actions"
import { cn } from "@/lib/utils"
import { safeHref } from "@/lib/markdown"
import { codeSource, shouldCopy, writeCode, type SourcePosition } from "@/lib/codeCopy"
import { projectUrl } from "@/lib/project"
import { toast } from "@/lib/toast"
import { AttachmentList, splitAttachments } from "./Attachments"

interface Node {
  type?: string; value?: string; tagName?: string; position?: SourcePosition
  properties?: Record<string, unknown>; children?: Node[]
}
function hastText(node?: Node): string { return node?.type === "text" ? node.value ?? "" : (node?.children ?? []).map(hastText).join("") }
function annotate(node: Node, blocked = false): void {
  const nested = blocked || node.tagName === "a"
  if (node.tagName === "code") node.properties = { ...node.properties, copyBlocked: nested, blockCode: blocked === false && node.properties?.blockCode }
  for (const child of node.children ?? []) {
    if (node.tagName === "pre") child.properties = { ...child.properties, blockCode: true }
    annotate(child, nested)
  }
}
function copyPlugin() { return (tree: unknown) => annotate(tree as Node) }

function useCopy(text: string) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await writeCode(text, navigator.clipboard); setCopied(true); toast.success("Code copied.") }
    catch { toast.error("Could not copy code. Select it and copy manually, or allow clipboard access.") }
  }
  return { copied, copy }
}

function CopyableCode({ text, children, block = false }: { text: string; children: ReactNode; block?: boolean }) {
  const { copy } = useCopy(text)
  const pointer = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined)
  return <code role="button" tabIndex={0} aria-label="Copy code" aria-keyshortcuts="Enter Space" title="Copy code · Enter / Space" className="cursor-copy focus-visible:outline-2 focus-visible:outline-ring"
    onPointerDown={(e) => { pointer.current = { x: e.clientX, y: e.clientY, moved: false } }}
    onPointerMove={(e) => { const p = pointer.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) p.moved = true }}
    onClick={(e) => { e.stopPropagation(); if (shouldCopy(window.getSelection()?.toString() ?? "", pointer.current?.moved ?? false)) void copy(); pointer.current = undefined }}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (shouldCopy(window.getSelection()?.toString() ?? "", false)) void copy() } }}>
    {children}{!block ? <span className="sr-only"> (activate to copy)</span> : null}
  </code>
}

function CodeBlock({ node, children, source }: { node?: unknown; children?: ReactNode; source: string }) {
  const n = node as Node | undefined
  const text = codeSource(source, n?.position, true) ?? hastText(n)
  const { copied, copy } = useCopy(text)
  const names = n?.children?.find((child) => child.tagName === "code")?.properties?.className
  const language = (Array.isArray(names) ? names : []).map(String).find((name) => name.startsWith("language-"))?.slice(9)
  return <div className="relative my-3 rounded-lg bg-muted">
    <div className="flex items-center justify-between pl-3"><span className="text-xs text-muted-foreground">{language && /^[\w+#.-]{1,20}$/.test(language) ? language : "code"} · tap to copy</span><ActionButton label={copied ? "Copied" : "Copy the code"} icon={copied ? Check : Copy} onClick={() => void copy()} /></div>
    <pre className="!my-0 overflow-x-auto !rounded-t-none !bg-transparent px-3 pb-3 text-sm leading-relaxed [&>code]:block">{children}</pre>
  </div>
}

function componentsFor(source: string): Components {
  return {
    pre: (props) => <CodeBlock {...props} source={source} />,
    code: ({ node, children }) => {
      const n = node as Node | undefined
      if (n?.properties?.copyBlocked) return <code>{children}</code>
      const block = Boolean(n?.properties?.blockCode)
      return <CopyableCode text={codeSource(source, n?.position, block) ?? hastText(n)} block={block}>{children}</CopyableCode>
    },
    a: ({ href, children }) => <a href={href ? projectUrl(href) : undefined} target="_blank" rel="noopener noreferrer nofollow">{children}</a>,
    img: ({ src, alt }) => <img src={src ? projectUrl(src) : undefined} alt={alt ?? ""} loading="lazy" />,
    table: ({ children }) => <div className="my-3 w-full overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
  }
}

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  const { body, files } = splitAttachments(text)
  return <div className={cn("md-body", className)}>
    {body ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[copyPlugin]} urlTransform={safeHref} components={componentsFor(body)}>{body}</ReactMarkdown> : null}
    <AttachmentList files={files} />
  </div>
})
