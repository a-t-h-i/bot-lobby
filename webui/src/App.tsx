import { Shell } from "@/app/Shell"
import { SignIn } from "@/app/SignIn"
import { LoadingState } from "@/app/States"
import { useBootstrap } from "@/app/bootstrap"
import { useStatus } from "@/app/hooks"

/** The gate in front of the shell: first paint, sign-in, shell. */
export function App() {
  const ready = useBootstrap()
  const { signedOut } = useStatus()

  if (!ready) return <LoadingState />
  if (signedOut) return <SignIn />
  return <Shell />
}

export default App
