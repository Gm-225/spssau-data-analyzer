import { useState, useCallback } from "react"
import { store } from "@/lib/store"
import { Header } from "@/components/layout/Header"
import { HomePage } from "@/pages/HomePage"
import { UploadPage } from "@/pages/UploadPage"
import { AiAssistantPage } from "@/pages/AiAssistantPage"
import { AnalysisPage } from "@/pages/AnalysisPage"
import { ResultsPage } from "@/pages/ResultsPage"
import { HelpDialog } from "@/components/layout/HelpDialog"
import { LoadingOverlay } from "@/components/layout/LoadingOverlay"
import { Toast } from "@/components/layout/Toast"
import { useAppState } from "@/hooks/useAppState"

export function App() {
  const state = useAppState()
  const [helpOpen, setHelpOpen] = useState(false)

  const openHelp = useCallback(() => setHelpOpen(true), [])
  const closeHelp = useCallback(() => setHelpOpen(false), [])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header onOpenHelp={openHelp} />
      <main className="flex-1">
        {state.currentPage === "home" && <HomePage />}
        {state.currentPage === "upload" && <UploadPage />}
        {state.currentPage === "analysis" && <AiAssistantPage />}
        {state.currentPage === "manual" && <AnalysisPage />}
        {state.currentPage === "results" && <ResultsPage />}
      </main>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      {state.isLoading && <LoadingOverlay />}
      {state.toastMessage && <Toast message={state.toastMessage} />}
    </div>
  )
}
