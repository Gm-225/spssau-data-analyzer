import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./App"
import "./index.css"

// Load external libraries before rendering
async function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    const script = document.createElement("script")
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => { console.warn(`Failed to load: ${src}`); resolve() }
    document.head.appendChild(script)
  })
}

async function init() {
  // Use relative paths for Electron file:// compatibility
  const base = import.meta.env.BASE_URL || "./"
  
  await Promise.all([
    loadScript(base + "xlsx.full.min.js"),
    loadScript(base + "papaparse.min.js"),
    loadScript(base + "jstat.min.js"),
    loadScript(base + "FileSaver.min.js"),
    loadScript(base + "html-docx.min.js"),
  ])

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

init()
