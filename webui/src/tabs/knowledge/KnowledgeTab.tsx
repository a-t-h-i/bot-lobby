import { BookOpen } from "lucide-react"
import { useTopic } from "@/app/hooks"
import { Conversation } from "../lobby/Conversation"
import { go, tabHash } from "@/app/router"
import { knowledgeView } from "@/app/knowledgeView"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Empty, EmptyMedia, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { FileDetail } from "./FileDetail"
import { fileKey, KnowledgeList } from "./KnowledgeList"
import type { KnowledgeFileInfo, LobbySnapshot, StatusInfo } from "@protocol"

const close = () => go(tabHash("knowledge"))
const open = (key: string) => {
  const [agent, file] = key.split("/")
  go(tabHash("knowledge", agent ?? "", file ?? ""))
}

function NoFiles() {
  return (
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BookOpen aria-hidden="true" /></EmptyMedia>
        <EmptyDescription>No knowledge files yet.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function detailFor(files: KnowledgeFileInfo[], agent: string | undefined, file: string | undefined, onChanged: () => void) {
  const chosen = files.find((info) => info.agent === agent && info.file === file)
  if (chosen) return <FileDetail key={fileKey(chosen)} agent={chosen.agent} file={chosen.file} onChanged={onChanged} />
  return agent && file ? <p className="text-sm text-muted-foreground">That file is not on the list any more.</p> : null
}

function KnowledgeChat() {
  const lobby = useTopic<LobbySnapshot>("lobby")
  const status = useTopic<StatusInfo>("status")
  const data = lobby.data
  const busy = status.data?.busy ?? false
  if (!data?.chat.length && !data?.reply && !busy) return (
    <p className="m-auto max-w-md px-5 pb-dock text-center text-sm text-muted-foreground">Ask about this project below. The oracle checks saved knowledge, searches the codebase for missing information, and saves verified findings.</p>
  )
  return <Conversation chat={data?.chat ?? []} reply={data?.reply} busy={busy} hasOlder={data?.hasOlderChat ?? false} hasTask={Boolean(data?.task)} />
}

type KnowledgeRead = ReturnType<typeof useApiRead<"knowledge.files">>

function FilesList({ read, selected }: { read: KnowledgeRead; selected?: string }) {
  const notes = read.data?.files.reduce((total, info) => total + info.notes, 0) ?? 0
  return <>
    <PaneHeader title="Knowledge" count={notes > 0 ? `${notes} note${notes === 1 ? "" : "s"}` : undefined} />
    <FilesContent read={read} selected={selected} />
  </>
}

function FilesContent({ read, selected }: { read: KnowledgeRead; selected?: string }) {
  if (!read.data && read.error) return <ErrorState message={`Could not load the knowledge files. ${read.error}`} onRetry={read.reload} />
  if (!read.data) return <ListSkeleton />
  if (!read.data.files.length) return <NoFiles />
  return <KnowledgeList files={read.data.files} models={read.data.models ?? {}} selectedKey={selected} onSelect={open} />
}

export function KnowledgeTab({ rest }: { rest: string[] }) {
  const { chat, agent, file } = knowledgeView(rest)
  const wide = useWide()
  const read = useApiRead("knowledge.files", {}, ["knowledge"])
  const files = read.data?.files ?? []
  const chosen = files.find((info) => info.agent === agent && info.file === file)
  return <SplitPane wide={wide} inlineDetail
    list={<FilesList read={read} selected={chosen ? fileKey(chosen) : undefined} />}
    detail={chat ? <KnowledgeChat /> : detailFor(files, agent, file, read.reload)}
    detailClassName={chat ? "flex flex-col overflow-hidden p-0" : undefined}
    open={chat || Boolean(agent && file)} onClose={close}
    hint="Select a file to read its entries, or ask about the project below."
    describe={chat ? "Knowledge chat" : "Knowledge file"} />
}
