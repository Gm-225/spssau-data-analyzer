import { useEffect, useState } from "react"
import { store, type AppState } from "@/lib/store"

export function useAppState(): AppState {
  const [state, setState] = useState<AppState>(store.getState())
  useEffect(() => store.subscribe(() => setState(store.getState())), [])
  return state
}
