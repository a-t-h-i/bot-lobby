import { Shell } from "@/app/Shell"
import { SignIn } from "@/app/SignIn"
import { LoadingState, NarrowWindow } from "@/app/States"
import { useBootstrap } from "@/app/bootstrap"
import { useMediaQuery, useStatus } from "@/app/hooks"

/** The gate in front of the shell: narrow notice, first paint, sign-in, shell. */
export function App() {
  const wide = useMediaQuery("(min-width: 768px)")
  const ready = useBootstrap()
  const { signedOut } = useStatus()

  if (!wide) return <NarrowWindow />
  if (!ready) return <LoadingState />
  if (signedOut) return <SignIn />
  return <Shell />
}

export default App
