import { useMemo } from "react"
import { staticPreviewDocument, type HtmlPreview } from "@/lib/staticPreview"

export function StaticPreview({ preview, label }: { preview: HtmlPreview; label: string }) {
  const source = useMemo(() => staticPreviewDocument(preview), [preview])
  return <iframe title={`Static mockup: ${label}`} sandbox="" referrerPolicy="no-referrer" srcDoc={source} className="h-80 w-full rounded-lg border bg-background" />
}
