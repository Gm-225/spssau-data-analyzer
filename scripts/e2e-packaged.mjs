import { _electron as electron, chromium } from "playwright-core"
import crypto from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultEvidenceRoot = "D:\\Desktop\\Codex-Projects\\AI-Analyzer-Package-Validation\\T-20260717-10\\run-ASCII"
const evidenceRoot = path.resolve(process.env.ANALYZER_PACKAGE_EVIDENCE_ROOT || defaultEvidenceRoot)
const releaseSource = (process.env.ANALYZER_RELEASE_SOURCE || "").trim().toLowerCase()
const profile = (process.env.ANALYZER_E2E_PROFILE || "").trim().toLowerCase()
const configuredAppDir = process.env.ANALYZER_PACKAGED_APP_DIR
  ? path.resolve(process.env.ANALYZER_PACKAGED_APP_DIR)
  : null
const configuredPortableExe = process.env.ANALYZER_PORTABLE_EXE
  ? path.resolve(process.env.ANALYZER_PORTABLE_EXE)
  : null
const fixturesDir = path.join(evidenceRoot, "fixtures")
const screenshotsDir = path.join(evidenceRoot, "screenshots")
const reportsRoot = path.join(evidenceRoot, "reports")
const knowledgeRoot = path.join(evidenceRoot, "knowledge")
const userDataRoot = path.join(evidenceRoot, "user-data")
const historicalOutputsRoot = path.join(root, "outputs")
const xlsxSource = path.join(root, "examples", "synthetic-questionnaire-seed20260717.xlsx")
const csvSource = path.join(root, "examples", "synthetic-questionnaire-seed20260717.csv")
const xlsxFixture = path.join(fixturesDir, path.basename(xlsxSource))
const csvFixture = path.join(fixturesDir, path.basename(csvSource))
const missingColumnFixture = path.join(fixturesDir, "synthetic-questionnaire-missing-AA3.csv")

const amosE2e = process.env.ANALYZER_E2E_AMOS === "1"
const BASE_FULL_PROMPT = "请对这份问卷数据做完整分析：PP为自变量、AA为因变量，PC和PI为并行中介，PV调节PP→AA直接路径；包括频数、描述统计、信度、效度、相关、Bootstrap中介和调节分析，并按分析报告模板输出。"
const FULL_PROMPT = amosE2e
  ? `${BASE_FULL_PROMPT} 同时调用本机 IBM SPSS Amos Engine 完成 CFA 和结构方程模型分析。`
  : BASE_FULL_PROMPT
const LIMITED_PROMPT = "只做问卷信度分析"
const INVALID_PROMPT = "请根据这份数据写一首宣传诗"
const REPORT_FILES = ["analysis-result.json", "问卷数据分析报告.docx", "问卷数据分析报告.pdf"]
const LIMITED_SECTIONS = ["1、数据质量与变量识别", "2、信度检验"]
const LIMITED_RAW_KEYS = ["analysisScope", "dataQuality", "planSummary", "prompt", "reliability", "seed"]
const REPRODUCIBILITY_RAW_KEYS = ["seed", "reliability", "kmo", "outcomeModel", "indirect", "slopes"]
const SYNTHETIC_BENCHMARK = {
  kmo: 0.8971807579830153,
  alphas: {
    PP: 0.9290370042867071,
    AA: 0.893457899907147,
    PC: 0.9223309487326403,
    PI: 0.9454808149932017,
    PV: 0.9288918429975316,
  },
  outcomeModel: {
    const: 1.1033939255207585,
    PP_c: 0.20422941187812949,
    PC: 0.20895105718546697,
    PI: 0.41725991738856594,
    PV_c: -0.15910984960128077,
    interaction: 0.12192767776172439,
  },
}

const networkRequests = []
const consoleErrors = []
const liveElectronApps = new Set()
const livePortableLaunches = new Set()
let tamperDeletion = { attempted: false, deleted: false, path: null }

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function assertSafePaths() {
  if (!/^[\x00-\x7F]+$/.test(evidenceRoot)) {
    throw new Error(`隔离证据目录必须是纯 ASCII 路径：${evidenceRoot}`)
  }
  if (isInside(root, evidenceRoot)) {
    throw new Error(`隔离证据目录不得位于源码目录内：${evidenceRoot}`)
  }
  if (!new Set(["nsis", "portable"]).has(releaseSource)) {
    throw new Error("ANALYZER_RELEASE_SOURCE 必填，且只能是 nsis 或 portable；禁止回退到 release\\win-unpacked。")
  }
  if (!new Set(["nsis", "portable", "tamper"]).has(profile)) {
    throw new Error("ANALYZER_E2E_PROFILE 必填，且只能是 nsis、portable 或 tamper。")
  }
  if (profile === "portable" && releaseSource !== "portable") {
    throw new Error("portable profile 必须使用 ANALYZER_RELEASE_SOURCE=portable。")
  }
  if ((profile === "nsis" || profile === "tamper") && releaseSource !== "nsis") {
    throw new Error(`${profile} profile 必须使用 ANALYZER_RELEASE_SOURCE=nsis。`)
  }

  if (releaseSource === "nsis") {
    if (!configuredAppDir) {
      throw new Error("NSIS 来源必须显式设置 ANALYZER_PACKAGED_APP_DIR；禁止回退到 release\\win-unpacked。")
    }
    if (!fs.existsSync(configuredAppDir) || !fs.statSync(configuredAppDir).isDirectory()) {
      throw new Error(`NSIS 实际安装目录不存在：${configuredAppDir}`)
    }
    if (isInside(path.join(root, "release"), configuredAppDir)) {
      throw new Error(`NSIS E2E 拒绝 release 目录及 win-unpacked：${configuredAppDir}`)
    }
    if (isInside(root, configuredAppDir)) {
      throw new Error(`NSIS E2E 必须从源码目录之外的实际安装目录启动：${configuredAppDir}`)
    }
  }

  if (releaseSource === "portable") {
    if (!configuredPortableExe) {
      throw new Error("Portable 来源必须显式设置 ANALYZER_PORTABLE_EXE；禁止解包后冒充 Portable.exe。")
    }
    if (!fs.existsSync(configuredPortableExe) || !fs.statSync(configuredPortableExe).isFile()) {
      throw new Error(`Portable.exe 不存在：${configuredPortableExe}`)
    }
    if (!/-Portable\.exe$/i.test(path.basename(configuredPortableExe))) {
      throw new Error(`ANALYZER_PORTABLE_EXE 必须指向正式 Portable.exe：${configuredPortableExe}`)
    }
  }

  if (profile === "tamper") {
    if (process.env.ANALYZER_TAMPER_DISPOSABLE !== "1") {
      throw new Error("tamper profile 需要 ANALYZER_TAMPER_DISPOSABLE=1，明确确认输入是可丢弃安装副本。")
    }
    if (!isInside(path.dirname(evidenceRoot), configuredAppDir)) {
      throw new Error(`tamper 安装副本必须位于本次证据根的父目录内：${configuredAppDir}`)
    }
    if (!/(tamper|disposable)/i.test(configuredAppDir)) {
      throw new Error(`tamper 安装副本目录名必须包含 tamper 或 disposable：${configuredAppDir}`)
    }
  }

  for (const samplePath of [xlsxSource, csvSource]) {
    if (path.dirname(samplePath) !== path.join(root, "examples") || !path.basename(samplePath).toLowerCase().includes("synthetic")) {
      throw new Error(`拒绝非 examples/synthetic 样本：${samplePath}`)
    }
    if (!fs.existsSync(samplePath)) throw new Error(`synthetic 样本不存在：${samplePath}`)
  }
  for (const ownedPath of [fixturesDir, screenshotsDir, reportsRoot, knowledgeRoot, userDataRoot]) {
    if (fs.existsSync(ownedPath)) throw new Error(`证据子目录已存在，拒绝覆盖：${ownedPath}`)
  }
  for (const fileName of [
    "e2e-summary.json",
    "e2e-failure.json",
    "historical-outputs-before.json",
    "historical-outputs-after.json",
    "network-requests.json",
  ]) {
    const candidate = path.join(evidenceRoot, fileName)
    if (fs.existsSync(candidate)) throw new Error(`证据文件已存在，拒绝覆盖：${candidate}`)
  }
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const files = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = path.join(current, entry.name)
      if (entry.isDirectory()) visit(candidate)
      else if (entry.isFile()) files.push(candidate)
    }
  }
  visit(directory)
  return files
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase()
}

function sha256Stream(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256")
    const stream = fs.createReadStream(filePath)
    stream.on("data", (chunk) => digest.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(digest.digest("hex").toUpperCase()))
  })
}

async function hashTreeCryptographicallyOnly(directory) {
  const snapshot = []
  for (const filePath of walkFiles(directory)) {
    const stat = fs.statSync(filePath)
    snapshot.push({
      path: path.relative(directory, filePath).replaceAll("\\", "/"),
      length: stat.size,
      sha256: await sha256Stream(filePath),
    })
  }
  return snapshot
}

function parseUtf8JsonBuffer(buffer, label) {
  const text = buffer.toString("utf8")
  if (!Buffer.from(text, "utf8").equals(buffer)) throw new Error(`${label} 不是有效 UTF-8 字节流`)
  return JSON.parse(text)
}

function readUtf8Json(filePath) {
  return parseUtf8JsonBuffer(fs.readFileSync(filePath), filePath)
}

function writeJson(filePath, payload) {
  const buffer = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(filePath, buffer, { flag: "wx" })
  parseUtf8JsonBuffer(fs.readFileSync(filePath), filePath)
  return buffer
}

function prepareEvidence() {
  fs.mkdirSync(evidenceRoot, { recursive: true })
  fs.mkdirSync(fixturesDir, { recursive: false })
  fs.mkdirSync(screenshotsDir, { recursive: false })
  fs.mkdirSync(reportsRoot, { recursive: false })
  fs.mkdirSync(userDataRoot, { recursive: false })
  fs.copyFileSync(xlsxSource, xlsxFixture, fs.constants.COPYFILE_EXCL)
  fs.copyFileSync(csvSource, csvFixture, fs.constants.COPYFILE_EXCL)
  createMissingAa3Fixture(csvFixture, missingColumnFixture)
}

function createMissingAa3Fixture(source, destination) {
  const lines = fs.readFileSync(source, "utf8").replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/)
  if (lines.length < 2) throw new Error("synthetic CSV 没有数据行")
  const rows = lines.map((line) => line.split(","))
  const width = rows[0].length
  if (rows.some((row) => row.length !== width)) {
    throw new Error("synthetic CSV 含逗号转义，当前缺列夹具生成器拒绝不安全改写")
  }
  const index = rows[0].findIndex((header) => /^AA3(?:_|$)/i.test(header))
  if (index < 0) throw new Error("synthetic CSV 未找到 AA3 列")
  for (const row of rows) row.splice(index, 1)
  fs.writeFileSync(destination, `${rows.map((row) => row.join(",")).join("\r\n")}\r\n`, "utf8")
}

function findPackagedExecutable(directory) {
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe") && !/uninstall|卸载/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
  if (!candidates.length) throw new Error(`NSIS 实际安装目录没有应用可执行文件：${directory}`)
  candidates.sort((left, right) => fs.statSync(right).size - fs.statSync(left).size)
  return candidates[0]
}

function directoryFootprint(directory) {
  const files = walkFiles(directory)
  return {
    fileCount: files.length,
    bytes: files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0),
  }
}

function sanitizedEnvironment(userDataDir, provenancePath) {
  const blocked = /^(path|pythonhome|pythonpath|virtual_env|conda.*|pip_.*|node_options|electron_run_as_node|analyzer_api_url)$/i
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !blocked.test(key)))
  const windowsRoot = process.env.SystemRoot || "C:\\Windows"
  return {
    ...env,
    NODE_ENV: "production",
    Path: `${path.join(windowsRoot, "System32")};${windowsRoot}`,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
    OPENBLAS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
    ANALYZER_REPORTS_ROOT: reportsRoot,
    ANALYZER_KNOWLEDGE_ROOT: knowledgeRoot,
    ANALYZER_DISABLE_CASE_MEMORY: "1",
    ANALYZER_PACKAGED_E2E: "1",
    ANALYZER_E2E_USER_DATA: userDataDir,
    ANALYZER_E2E_PROVENANCE_PATH: provenancePath,
  }
}

function attachPageEvidence(page, label) {
  page.on("request", (request) => {
    if (/^(https?|wss?):/i.test(request.url())) {
      networkRequests.push({ label, method: request.method(), resourceType: request.resourceType(), url: request.url() })
    }
  })
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ label, type: "console", message: message.text() })
  })
  page.on("pageerror", (error) => consoleErrors.push({ label, type: "pageerror", message: error.message }))
}

async function waitForJsonFile(filePath, timeoutMs = 60_000) {
  const started = performance.now()
  let lastError
  while (performance.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) {
      try {
        return readUtf8Json(filePath)
      } catch (error) {
        lastError = error
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`等待 packaged 进程 provenance 超时：${filePath}${lastError ? `；${lastError.message}` : ""}`)
}

async function captureRuntimeIdentity(provenance) {
  const resourcesPath = path.resolve(provenance.resourcesPath)
  const manifestPath = path.join(resourcesPath, "runtime-manifest.json")
  const runtimeExe = path.join(resourcesPath, "runtime", "questionnaire-engine", "questionnaire-engine.exe")
  if (!fs.existsSync(manifestPath) || !fs.existsSync(runtimeExe)) {
    throw new Error(`packaged 运行时资源不完整：${resourcesPath}`)
  }
  return {
    resourcesPath,
    manifestPath,
    manifestSha256: await sha256Stream(manifestPath),
    runtimeExecutable: runtimeExe,
    runtimeExecutableSha256: await sha256Stream(runtimeExe),
  }
}

async function launchInstalled(label) {
  const launchStarted = performance.now()
  const userDataDir = path.join(userDataRoot, label)
  const provenancePath = path.join(evidenceRoot, `process-provenance-${label}.json`)
  fs.mkdirSync(userDataDir, { recursive: false })
  const executable = findPackagedExecutable(configuredAppDir)
  const executableSha256 = await sha256Stream(executable)
  const electronApp = await electron.launch({
    executablePath: executable,
    cwd: configuredAppDir,
    args: [
      `--user-data-dir=${userDataDir}`,
      "--proxy-server=http://127.0.0.1:9",
      "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost",
    ],
    env: sanitizedEnvironment(userDataDir, provenancePath),
  })
  liveElectronApps.add(electronApp)
  const page = await electronApp.firstWindow({ timeout: 60_000 })
  const browserWindow = await electronApp.browserWindow(page)
  await browserWindow.evaluate((window) => window.setSize(1440, 900))
  attachPageEvidence(page, label)
  const provenance = await waitForJsonFile(provenancePath)
  const launchProcessPid = electronApp.process()?.pid
  if (!launchProcessPid || provenance.parentPid !== launchProcessPid) {
    throw new Error(`NSIS 实际进程父 PID 与 Playwright 启动进程不一致：${provenance.parentPid} / ${launchProcessPid}`)
  }
  if (!provenance.appIsPackaged || !samePath(provenance.execPath, executable)) {
    throw new Error(`NSIS provenance 未指向实际安装 EXE：${provenance.execPath} / ${executable}`)
  }
  const processChain = buildPortableProcessChain(queryWindowsProcesses(), provenance.pid, launchProcessPid)
  const actualRecord = processChain[0]
  if (!actualRecord.executablePath || !samePath(actualRecord.executablePath, executable)) {
    throw new Error(`Win32_Process 未确认 NSIS 实际安装 EXE：${actualRecord.executablePath} / ${executable}`)
  }
  const identity = {
    kind: "nsis-installed",
    sourceAppDir: configuredAppDir,
    launchProcessPid,
    processChain,
    actualExecutable: {
      path: executable,
      pid: provenance.pid,
      parentPid: provenance.parentPid,
      sha256: executableSha256,
    },
    provenancePath,
    provenance,
    runtime: await captureRuntimeIdentity(provenance),
    appFootprint: directoryFootprint(configuredAppDir),
  }
  return { kind: "electron", electronApp, page, identity, launchSeconds: (performance.now() - launchStarted) / 1000 }
}

async function allocateLoopbackPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : null
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!port) throw new Error("无法分配 Portable 本机 CDP 端口")
  return port
}

function queryWindowsProcesses() {
  const windowsRoot = process.env.SystemRoot || "C:\\Windows"
  const powershell = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  const command = [
    "$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress -Depth 3",
  ].join("; ")
  const raw = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
  if (!raw) return []
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""))
  return Array.isArray(parsed) ? parsed : [parsed]
}

function buildPortableProcessChain(processes, actualPid, wrapperPid) {
  const byPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))
  const chain = []
  const seen = new Set()
  let currentPid = Number(actualPid)
  while (currentPid && !seen.has(currentPid)) {
    seen.add(currentPid)
    const entry = byPid.get(currentPid)
    if (!entry) break
    chain.push({
      pid: Number(entry.ProcessId),
      parentPid: Number(entry.ParentProcessId),
      name: entry.Name || null,
      executablePath: entry.ExecutablePath || null,
      commandLine: entry.CommandLine || null,
    })
    if (currentPid === Number(wrapperPid)) break
    currentPid = Number(entry.ParentProcessId)
  }
  if (!chain.some((entry) => entry.pid === Number(wrapperPid))) {
    throw new Error(`Portable 实际 Electron PID ${actualPid} 的祖先链不包含 wrapper PID ${wrapperPid}`)
  }
  return chain
}

function assertPortableProcessIsolation() {
  const fallbackTemp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Temp") : "C:\\Windows\\Temp"
  const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || fallbackTemp)
  const conflicts = queryWindowsProcesses().filter((entry) => {
    const executablePath = entry.ExecutablePath
    if (!executablePath || Number(entry.ProcessId) === process.pid) return false
    if (samePath(executablePath, configuredPortableExe)) return true
    return isInside(tempRoot, executablePath) && /AI数据分析器\.exe$/i.test(executablePath)
  }).map((entry) => ({
    pid: Number(entry.ProcessId),
    parentPid: Number(entry.ParentProcessId),
    name: entry.Name || null,
    executablePath: entry.ExecutablePath || null,
    commandLine: entry.CommandLine || null,
  }))
  if (conflicts.length) {
    throw new Error(`Portable 验收必须串行；发现既有 wrapper/临时 Electron 进程：${conflicts.map((entry) => `${entry.pid}:${entry.executablePath}`).join(" | ")}`)
  }
  return { checked: true, tempRoot, preexistingConflictingProcesses: [] }
}

async function connectPortableCdp(port, wrapper, timeoutMs = 90_000) {
  const endpoint = `http://127.0.0.1:${port}`
  const started = performance.now()
  let lastError
  while (performance.now() - started < timeoutMs) {
    if (wrapper.exitCode !== null) throw new Error(`Portable.exe 在 CDP 建立前退出，退出码 ${wrapper.exitCode}`)
    try {
      return await chromium.connectOverCDP(endpoint, { timeout: 2_000 })
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Portable.exe 未开放本机 CDP：${lastError?.message || endpoint}`)
}

async function firstCdpPage(browser, timeoutMs = 60_000) {
  const started = performance.now()
  while (performance.now() - started < timeoutMs) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => !candidate.url().startsWith("devtools://"))
      if (page) return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Portable Electron 已启动，但未出现应用窗口")
}

async function resizeApplicationWindow(page, width, height) {
  try {
    const session = await page.context().newCDPSession(page)
    const { windowId } = await session.send("Browser.getWindowForTarget")
    await session.send("Browser.setWindowBounds", { windowId, bounds: { width, height, windowState: "normal" } })
    await session.detach()
  } catch {
    await page.setViewportSize({ width, height })
  }
  await page.waitForTimeout(200)
}

async function validateResponsiveLayouts(page) {
  const records = []
  for (const requested of [
    { width: 900, height: 600 },
    { width: 1280, height: 860 },
    { width: 1440, height: 900 },
  ]) {
    await resizeApplicationWindow(page, requested.width, requested.height)
    const actual = await page.evaluate(() => ({
      innerWidth,
      innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }))
    if (actual.documentWidth > actual.innerWidth + 1 || actual.bodyWidth > actual.innerWidth + 1) {
      throw new Error(`AI 助手页在 ${requested.width}x${requested.height} 窗口横向溢出：document=${actual.documentWidth}, body=${actual.bodyWidth}, viewport=${actual.innerWidth}`)
    }
    records.push({ requested, actual, horizontalOverflow: false })
    if (requested.width === 900) {
      await page.screenshot({ path: path.join(screenshotsDir, "00-ai-assistant-900x600.png"), fullPage: true })
    }
  }
  return records
}

async function validateManualVariableLayout(page) {
  await page.getByRole("button", { name: "手动分析", exact: true }).click()
  await page.getByText("变量列表", { exact: true }).waitFor({ timeout: 10_000 })
  await resizeApplicationWindow(page, 900, 600)
  const row = page.locator('[title^="PP1"]').first()
  await row.waitFor({ timeout: 10_000 })
  const metrics = await row.evaluate((element) => {
    const label = element.querySelector("span")
    const rowRect = element.getBoundingClientRect()
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      rowLeft: rowRect.left,
      rowRight: rowRect.right,
      rowOverflowX: getComputedStyle(element).overflowX,
      labelClientWidth: label?.clientWidth ?? 0,
      labelScrollWidth: label?.scrollWidth ?? 0,
      labelTextOverflow: label ? getComputedStyle(label).textOverflow : null,
    }
  })
  if (metrics.documentWidth > metrics.viewportWidth + 1 || metrics.rowRight > metrics.viewportWidth + 1) {
    throw new Error(`手动分析页长变量越界：rowRight=${metrics.rowRight}, document=${metrics.documentWidth}, viewport=${metrics.viewportWidth}`)
  }
  if (metrics.labelScrollWidth <= metrics.labelClientWidth || metrics.labelTextOverflow !== "ellipsis") {
    throw new Error(`手动分析页长变量未正确省略：${JSON.stringify(metrics)}`)
  }
  await page.screenshot({ path: path.join(screenshotsDir, "00-manual-analysis-900x600.png"), fullPage: true })
  await page.getByRole("button", { name: "数据分析", exact: true }).click()
  await page.getByText("自动识别：", { exact: true }).waitFor({ timeout: 10_000 })
  await resizeApplicationWindow(page, 1440, 900)
  return { ...metrics, longVariableTruncated: true, horizontalOverflow: false }
}

async function launchPortable(label) {
  const launchStarted = performance.now()
  const serialIsolation = assertPortableProcessIsolation()
  const userDataDir = path.join(userDataRoot, label)
  const provenancePath = path.join(evidenceRoot, `process-provenance-${label}.json`)
  fs.mkdirSync(userDataDir, { recursive: false })
  const cdpPort = await allocateLoopbackPort()
  const wrapperSha256 = await sha256Stream(configuredPortableExe)
  const wrapperOutput = { stdout: "", stderr: "" }
  const args = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--proxy-server=http://127.0.0.1:9",
    "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost",
  ]
  const wrapper = spawn(configuredPortableExe, args, {
    cwd: path.dirname(configuredPortableExe),
    env: sanitizedEnvironment(userDataDir, provenancePath),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (!wrapper.pid) throw new Error(`无法从 Portable.exe 本体启动：${configuredPortableExe}`)
  wrapper.stdout.on("data", (chunk) => { wrapperOutput.stdout = `${wrapperOutput.stdout}${chunk}`.slice(-8_000) })
  wrapper.stderr.on("data", (chunk) => { wrapperOutput.stderr = `${wrapperOutput.stderr}${chunk}`.slice(-8_000) })
  const launch = { wrapper, browser: null, identity: null }
  livePortableLaunches.add(launch)
  const browser = await connectPortableCdp(cdpPort, wrapper)
  launch.browser = browser
  const page = await firstCdpPage(browser)
  try {
    const context = page.context()
    const session = await context.newCDPSession(page)
    const { windowId } = await session.send("Browser.getWindowForTarget")
    await session.send("Browser.setWindowBounds", { windowId, bounds: { width: 1440, height: 900, windowState: "normal" } })
    await session.detach()
  } catch {
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  attachPageEvidence(page, label)

  const provenance = await waitForJsonFile(provenancePath)
  if (!provenance.appIsPackaged) throw new Error("Portable 子进程 provenance 显示 appIsPackaged=false")
  if (!provenance.portable?.executableFile || !samePath(provenance.portable.executableFile, configuredPortableExe)) {
    throw new Error(`Portable 注入来源与 wrapper 不一致：${provenance.portable?.executableFile} / ${configuredPortableExe}`)
  }
  if (!fs.existsSync(provenance.execPath)) throw new Error(`Portable 实际 Electron EXE 已不存在：${provenance.execPath}`)
  const processes = queryWindowsProcesses()
  const chain = buildPortableProcessChain(processes, provenance.pid, wrapper.pid)
  const actualRecord = chain[0]
  if (!actualRecord.executablePath || !samePath(actualRecord.executablePath, provenance.execPath)) {
    throw new Error(`Win32_Process 与 provenance 的实际 Electron 路径不一致：${actualRecord.executablePath} / ${provenance.execPath}`)
  }
  const wrapperRecord = chain.find((entry) => entry.pid === wrapper.pid)
  if (!wrapperRecord?.executablePath || !samePath(wrapperRecord.executablePath, configuredPortableExe)) {
    throw new Error(`Win32_Process 未确认 Portable wrapper 路径：${wrapperRecord?.executablePath} / ${configuredPortableExe}`)
  }

  launch.identity = {
    kind: "portable-wrapper",
    wrapper: {
      path: configuredPortableExe,
      pid: wrapper.pid,
      parentPid: wrapperRecord.parentPid,
      sha256: wrapperSha256,
      args,
    },
    actualExecutable: {
      path: provenance.execPath,
      pid: provenance.pid,
      parentPid: provenance.parentPid,
      sha256: await sha256Stream(provenance.execPath),
    },
    processChain: chain,
    provenancePath,
    provenance,
    runtime: await captureRuntimeIdentity(provenance),
    cdp: { transport: "loopback-only", port: cdpPort },
    serialIsolation,
    wrapperOutput,
  }
  return { kind: "portable", launch, page, identity: launch.identity, launchSeconds: (performance.now() - launchStarted) / 1000 }
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return true
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once("exit", onExit)
  })
}

async function closeLaunch(launched) {
  if (!launched) return { graceful: true, forced: false }
  if (launched.kind === "electron") {
    if (!liveElectronApps.has(launched.electronApp)) return { graceful: true, forced: false }
    try {
      await launched.electronApp.close()
      return { graceful: true, forced: false }
    } catch {
      return { graceful: false, forced: false }
    } finally {
      liveElectronApps.delete(launched.electronApp)
    }
  }

  const { launch } = launched
  if (!livePortableLaunches.has(launch)) return launch.identity?.shutdown || { graceful: true, forced: false }
  let graceful = false
  let forced = false
  try {
    if (launch.browser) {
      for (const context of launch.browser.contexts()) {
        for (const page of context.pages()) await page.close({ runBeforeUnload: false }).catch(() => {})
      }
    }
    graceful = await waitForProcessExit(launch.wrapper, 10_000)
    if (launch.browser) await launch.browser.close().catch(() => {})
    if (!graceful && launch.wrapper.pid) {
      const windowsRoot = process.env.SystemRoot || "C:\\Windows"
      execFileSync(path.join(windowsRoot, "System32", "taskkill.exe"), ["/PID", String(launch.wrapper.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
      forced = true
      await waitForProcessExit(launch.wrapper, 10_000)
    }
  } finally {
    livePortableLaunches.delete(launch)
  }
  const shutdown = { graceful, forced, wrapperExitCode: launch.wrapper.exitCode }
  if (launch.identity) launch.identity.shutdown = shutdown
  return shutdown
}

function listJobDirs() {
  if (!fs.existsSync(reportsRoot)) return []
  return fs.readdirSync(reportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(reportsRoot, entry.name))
    .sort()
}

function newJobDirs(before) {
  const known = new Set(before)
  return listJobDirs().filter((entry) => !known.has(entry))
}

function reportArtifactsIn(directory) {
  return walkFiles(directory).filter((filePath) => REPORT_FILES.includes(path.basename(filePath)))
}

function assertNoReportArtifacts(jobDirs, label) {
  const artifacts = jobDirs.flatMap((jobDir) => reportArtifactsIn(jobDir))
  if (artifacts.length) throw new Error(`${label} 失败任务生成了伪报告：${artifacts.join(" | ")}`)
}

async function validateReport(jobDir) {
  const artifacts = {}
  for (const fileName of REPORT_FILES) {
    const artifactPath = path.join(jobDir, fileName)
    if (!fs.existsSync(artifactPath) || fs.statSync(artifactPath).size < 1000) {
      throw new Error(`packaged 输出缺失或过小：${artifactPath}`)
    }
    const descriptor = fs.openSync(artifactPath, "r")
    const header = Buffer.alloc(8)
    try {
      fs.readSync(descriptor, header, 0, header.length, 0)
    } finally {
      fs.closeSync(descriptor)
    }
    if (fileName.endsWith(".docx") && (header[0] !== 0x50 || header[1] !== 0x4b)) {
      throw new Error(`DOCX 不是 ZIP/OOXML 格式：${artifactPath}`)
    }
    if (fileName.endsWith(".pdf") && !header.toString("ascii", 0, 5).startsWith("%PDF-")) {
      throw new Error(`PDF 文件头无效：${artifactPath}`)
    }
    artifacts[fileName] = {
      path: artifactPath,
      length: fs.statSync(artifactPath).size,
      sha256: await sha256Stream(artifactPath),
    }
  }
  const result = readUtf8Json(path.join(jobDir, "analysis-result.json"))
  return { artifacts, result }
}

function assertClose(actual, expected, label, tolerance = 1e-10) {
  if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} 科学基准不一致：${actual} != ${expected}（容差 ${tolerance}）`)
  }
}

function validateFullScience(result) {
  const raw = result?.raw
  if (!raw) throw new Error("完整分析 JSON 缺少 raw 科学结果")
  if (raw.seed !== 20260712) throw new Error(`固定随机种子异常：${raw.seed}`)
  if (raw.bootstrapSamples !== 5000) throw new Error(`Bootstrap 次数异常：${raw.bootstrapSamples}`)
  assertClose(raw.kmo, SYNTHETIC_BENCHMARK.kmo, "KMO")
  for (const [name, expected] of Object.entries(SYNTHETIC_BENCHMARK.alphas)) {
    assertClose(raw.reliability?.[name], expected, `${name} Cronbach alpha`)
  }
  for (const [name, expected] of Object.entries(SYNTHETIC_BENCHMARK.outcomeModel)) {
    assertClose(raw.outcomeModel?.[name], expected, `OLS ${name}`)
  }
  return {
    seed: raw.seed,
    bootstrapSamples: raw.bootstrapSamples,
    kmo: raw.kmo,
    alphas: raw.reliability,
    outcomeModel: raw.outcomeModel,
  }
}

async function validateAmosScience(result, jobDir) {
  if (!amosE2e) return null
  const amos = result?.raw?.amos
  if (!amos) throw new Error("AMOS packaged E2E 缺少 raw.amos 真实结果")
  if (amos.engine?.name !== "IBM SPSS Amos Engine") throw new Error(`AMOS Engine 名称异常：${amos.engine?.name}`)
  if (String(amos.engine?.engineDllSha256).toLowerCase() !== "347c2a654ffc6a638ae85d7f85d0f4815df47c1ccf316b5119233a304c476edb") {
    throw new Error(`AMOS Engine DLL 哈希异常：${amos.engine?.engineDllSha256}`)
  }
  if (Object.hasOwn(amos.engine || {}, "amosHome")) throw new Error("AMOS 结果泄露了本机安装目录")
  if (amos.rawOutput !== "AMOS原始输出.AmosOutput.html") throw new Error(`AMOS 原始输出引用不稳定：${amos.rawOutput}`)
  if (amos.status?.returnCode !== 0 || !amos.status?.stable || !amos.status?.admissible) {
    throw new Error("AMOS packaged 模型未稳定得到可接受解")
  }
  if (amos.status?.sampleSize !== 160 || amos.status?.observedVariables !== 20) {
    throw new Error(`AMOS packaged 样本/题项异常：${amos.status?.sampleSize}/${amos.status?.observedVariables}`)
  }
  assertClose(amos.fit?.CMIN, 200.797, "AMOS CMIN", 0.001)
  assertClose(amos.fit?.CFI, 0.986, "AMOS CFI", 0.001)
  assertClose(amos.fit?.TLI, 0.984, "AMOS TLI", 0.001)
  assertClose(amos.fit?.RMSEA, 0.038, "AMOS RMSEA", 0.001)
  if (amos.bootstrap?.samplesRequested !== 5000 || amos.effects?.validBootstrapSamples !== 5000) {
    throw new Error(`AMOS Bootstrap 有效数异常：${amos.effects?.validBootstrapSamples}/${amos.bootstrap?.samplesRequested}`)
  }
  const ppToAa = amos.parameters?.find((row) => row.source === "PP" && row.target === "AA")
  assertClose(ppToAa?.estimate, 0.2367679545231359, "AMOS PP->AA B", 1e-9)
  assertClose(ppToAa?.standardized, 0.24417369160347138, "AMOS PP->AA beta", 1e-9)
  const artifactNames = ["amos-engine-result.json", "AMOS原始输出.AmosOutput.html", "AMOS结构方程模型图.png"]
  const artifacts = {}
  for (const name of artifactNames) {
    const artifactPath = path.join(jobDir, name)
    if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile() || fs.statSync(artifactPath).size < 1000) {
      throw new Error(`AMOS packaged 产物缺失或异常：${artifactPath}`)
    }
    artifacts[name] = { length: fs.statSync(artifactPath).size, sha256: await sha256Stream(artifactPath) }
  }
  return {
    engineDllSha256: amos.engine.engineDllSha256,
    fit: { CMIN: amos.fit.CMIN, CFI: amos.fit.CFI, TLI: amos.fit.TLI, RMSEA: amos.fit.RMSEA },
    bootstrap: { requested: amos.bootstrap.samplesRequested, valid: amos.effects.validBootstrapSamples },
    ppToAa: { B: ppToAa.estimate, beta: ppToAa.standardized },
    artifacts,
  }
}

function validateFixedSeedReproduction(firstResult, repeatResult) {
  const firstRaw = firstResult?.raw
  const repeatRaw = repeatResult?.raw
  if (!firstRaw || !repeatRaw) throw new Error("固定种子复现缺少 raw 科学结果")
  const firstFingerprint = Object.fromEntries(REPRODUCIBILITY_RAW_KEYS.map((key) => [key, firstRaw[key]]))
  const repeatFingerprint = Object.fromEntries(REPRODUCIBILITY_RAW_KEYS.map((key) => [key, repeatRaw[key]]))
  const firstJson = JSON.stringify(firstFingerprint)
  const repeatJson = JSON.stringify(repeatFingerprint)
  if (firstJson !== repeatJson) {
    throw new Error(`固定种子复现不一致：${sha256Buffer(Buffer.from(firstJson))} != ${sha256Buffer(Buffer.from(repeatJson))}`)
  }
  let amosFingerprintSha256 = null
  if (amosE2e) {
    const keys = ["fit", "parameters", "validity", "rSquared", "effects", "bootstrap"]
    const firstAmos = Object.fromEntries(keys.map((key) => [key, firstRaw.amos?.[key]]))
    const repeatAmos = Object.fromEntries(keys.map((key) => [key, repeatRaw.amos?.[key]]))
    const firstAmosJson = JSON.stringify(firstAmos)
    const repeatAmosJson = JSON.stringify(repeatAmos)
    if (firstAmosJson !== repeatAmosJson) {
      throw new Error(`AMOS 固定种子复现不一致：${sha256Buffer(Buffer.from(firstAmosJson))} != ${sha256Buffer(Buffer.from(repeatAmosJson))}`)
    }
    amosFingerprintSha256 = sha256Buffer(Buffer.from(firstAmosJson))
  }
  return {
    identical: true,
    comparedRawKeys: REPRODUCIBILITY_RAW_KEYS,
    firstFingerprintSha256: sha256Buffer(Buffer.from(firstJson)),
    repeatFingerprintSha256: sha256Buffer(Buffer.from(repeatJson)),
    amosFingerprintSha256,
  }
}

function validateLimitedScope(result, jobDir) {
  const sections = result.tables
    .filter((item) => item.type === "text" && /^\d+、/.test(item.title))
    .map((item) => item.title)
  if (JSON.stringify(sections) !== JSON.stringify(LIMITED_SECTIONS)) {
    throw new Error(`CSV 只做信度章节越界：${JSON.stringify(sections)}`)
  }
  const rawKeys = Object.keys(result.raw || {}).sort()
  if (JSON.stringify(rawKeys) !== JSON.stringify(LIMITED_RAW_KEYS)) {
    throw new Error(`CSV 只做信度 raw 字段越界：${JSON.stringify(rawKeys)}`)
  }
  for (const name of ["研究模型图.png", "调节效应图.png"]) {
    if (fs.existsSync(path.join(jobDir, name))) throw new Error(`CSV 只做信度生成了未请求模型图：${name}`)
  }
  for (const [name, expected] of Object.entries(SYNTHETIC_BENCHMARK.alphas)) {
    assertClose(result.raw?.reliability?.[name], expected, `CSV ${name} Cronbach alpha`)
  }
  return { seed: result.raw.seed, sections, rawKeys, alphas: result.raw.reliability }
}

async function uploadSample(page, filePath, expectedShape) {
  await page.getByRole("button", { name: "数据上传", exact: true }).click()
  const input = page.locator('input[type="file"]').first()
  await input.setInputFiles(filePath)
  await page.getByText(expectedShape, { exact: true }).waitFor({ timeout: 30_000 })
  await page.getByRole("button", { name: "前往数据分析", exact: true }).click()
  await page.getByText("自动识别：", { exact: true }).waitFor({ timeout: 10_000 })
}

async function setPrompt(page, prompt) {
  const textarea = page.locator("textarea").first()
  await textarea.waitFor({ timeout: 10_000 })
  await textarea.fill(prompt)
}

async function waitForFailure(page, expected) {
  const toast = page.getByText(/一键分析失败:/)
  await toast.waitFor({ timeout: 60_000 })
  const message = (await toast.textContent()) || ""
  if (!expected.test(message)) throw new Error(`失败错误信息不明确：${message}`)
  return message
}

async function runNsisFlow(page, durations) {
  await uploadSample(page, xlsxFixture, "160 行 × 26 列")
  await setPrompt(page, FULL_PROMPT)
  const responsiveLayouts = await validateResponsiveLayouts(page)
  const manualVariableLayout = await validateManualVariableLayout(page)
  await page.screenshot({ path: path.join(screenshotsDir, "01-nsis-full-plan.png"), fullPage: true })
  const layout = await page.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }))
  if (layout.documentWidth > layout.viewportWidth + 1) {
    throw new Error(`NSIS 分析页产生横向溢出：${layout.documentWidth} > ${layout.viewportWidth}`)
  }

  const beforeFull = listJobDirs()
  const fullStarted = performance.now()
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  await page.getByRole("button", { name: "打开Word", exact: true }).waitFor({ timeout: 240_000 })
  await page.getByRole("button", { name: "打开PDF", exact: true }).waitFor()
  durations.xlsxFullAnalysis = (performance.now() - fullStarted) / 1000
  await page.getByText("1、数据质量与变量识别", { exact: true }).waitFor()
  await page.screenshot({ path: path.join(screenshotsDir, "02-nsis-full-result.png"), fullPage: true })
  const fullJobs = newJobDirs(beforeFull)
  if (fullJobs.length !== 1) throw new Error(`NSIS 完整分析新任务目录数量异常：${fullJobs.length}`)
  const fullReport = await validateReport(fullJobs[0])
  const science = validateFullScience(fullReport.result)
  const amos = await validateAmosScience(fullReport.result, fullJobs[0])

  await page.getByRole("button", { name: "数据分析", exact: true }).click()
  await setPrompt(page, INVALID_PROMPT)
  const beforeInvalid = listJobDirs()
  const invalidStarted = performance.now()
  const invalidFailure = waitForFailure(page, /未识别到可执行的分析需求/)
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  const invalidMessage = await invalidFailure
  durations.invalidDemand = (performance.now() - invalidStarted) / 1000
  await page.screenshot({ path: path.join(screenshotsDir, "03-nsis-invalid-demand.png"), fullPage: true })
  const invalidJobs = newJobDirs(beforeInvalid)
  if (invalidJobs.length !== 1) throw new Error(`NSIS 无效需求新任务目录数量异常：${invalidJobs.length}`)
  assertNoReportArtifacts(invalidJobs, "NSIS 无效需求")

  await setPrompt(page, FULL_PROMPT)
  const beforeFullRepeat = listJobDirs()
  const fullRepeatStarted = performance.now()
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  await page.getByRole("button", { name: "打开Word", exact: true }).waitFor({ timeout: 240_000 })
  await page.getByRole("button", { name: "打开PDF", exact: true }).waitFor()
  durations.xlsxFullAnalysisRepeat = (performance.now() - fullRepeatStarted) / 1000
  const fullRepeatJobs = newJobDirs(beforeFullRepeat)
  if (fullRepeatJobs.length !== 1) throw new Error(`NSIS 固定种子复跑新任务目录数量异常：${fullRepeatJobs.length}`)
  const fullRepeatReport = await validateReport(fullRepeatJobs[0])
  validateFullScience(fullRepeatReport.result)
  await validateAmosScience(fullRepeatReport.result, fullRepeatJobs[0])
  const reproducibility = validateFixedSeedReproduction(fullReport.result, fullRepeatReport.result)

  return {
    layout,
    responsiveLayouts,
    manualVariableLayout,
    reports: {
      full: { jobDir: fullJobs[0], ...fullReport },
      fullRepeat: { jobDir: fullRepeatJobs[0], ...fullRepeatReport },
    },
    failures: { invalidDemand: { message: invalidMessage, jobDirs: invalidJobs, reportArtifacts: 0 } },
    science: { ...science, amos, reproducibility },
  }
}

async function runPortableFlow(page, durations) {
  await uploadSample(page, csvFixture, "160 行 × 26 列")
  await setPrompt(page, LIMITED_PROMPT)
  await page.screenshot({ path: path.join(screenshotsDir, "01-portable-reliability-plan.png"), fullPage: true })
  const beforeLimited = listJobDirs()
  const limitedStarted = performance.now()
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  await page.getByText("2、信度检验", { exact: true }).waitFor({ timeout: 240_000 })
  durations.csvReliabilityOnly = (performance.now() - limitedStarted) / 1000
  await page.screenshot({ path: path.join(screenshotsDir, "02-portable-reliability-result.png"), fullPage: true })
  const limitedJobs = newJobDirs(beforeLimited)
  if (limitedJobs.length !== 1) throw new Error(`Portable CSV 只做信度新任务目录数量异常：${limitedJobs.length}`)
  const limitedReport = await validateReport(limitedJobs[0])
  const science = validateLimitedScope(limitedReport.result, limitedJobs[0])

  await uploadSample(page, missingColumnFixture, "160 行 × 25 列")
  await setPrompt(page, FULL_PROMPT)
  const beforeMissingColumn = listJobDirs()
  const missingColumnStarted = performance.now()
  const missingColumnFailure = waitForFailure(page, /维度 AA 期望 3 个题项，实际识别 2 个/)
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  const missingColumnMessage = await missingColumnFailure
  durations.missingColumn = (performance.now() - missingColumnStarted) / 1000
  await page.screenshot({ path: path.join(screenshotsDir, "03-portable-missing-AA3.png"), fullPage: true })
  const missingColumnJobs = newJobDirs(beforeMissingColumn)
  if (missingColumnJobs.length !== 1) throw new Error(`Portable 缺 AA3 新任务目录数量异常：${missingColumnJobs.length}`)
  assertNoReportArtifacts(missingColumnJobs, "Portable 缺 AA3")

  return {
    reports: { csvReliabilityOnly: { jobDir: limitedJobs[0], ...limitedReport, scope: science } },
    failures: { missingColumn: { message: missingColumnMessage, jobDirs: missingColumnJobs, reportArtifacts: 0 } },
    science,
  }
}

async function tamperManifestProtectedFile() {
  const resourcesRoot = path.join(configuredAppDir, "resources")
  const manifestPath = path.join(resourcesRoot, "runtime-manifest.json")
  if (!fs.existsSync(manifestPath)) throw new Error(`tamper 副本缺少运行时清单：${manifestPath}`)
  const manifest = readUtf8Json(manifestPath)
  const entry = manifest.criticalFiles?.find((item) => /pipeline\/questionnaire_pipeline\.py$/i.test(item.path))
    || manifest.criticalFiles?.find((item) => typeof item?.path === "string")
  if (!entry) throw new Error("tamper 副本清单没有 criticalFiles")
  const target = path.resolve(resourcesRoot, entry.path)
  if (!isInside(resourcesRoot, target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`tamper 目标越界或不存在：${target}`)
  }
  const beforeSha256 = await sha256Stream(target)
  if (beforeSha256 !== String(entry.sha256).toUpperCase()) {
    throw new Error(`tamper 前 critical file 已与清单不一致：${target}`)
  }
  fs.appendFileSync(target, Buffer.from("\n# issue-008-dynamic-tamper\n", "utf8"))
  const afterSha256 = await sha256Stream(target)
  if (beforeSha256 === afterSha256) throw new Error("tamper 未改变受保护文件哈希")
  return {
    manifestPath,
    manifestSha256: await sha256Stream(manifestPath),
    protectedRelativePath: entry.path,
    protectedPath: target,
    expectedSha256: String(entry.sha256).toUpperCase(),
    beforeSha256,
    afterSha256,
  }
}

async function runTamperFlow(page, durations) {
  await uploadSample(page, xlsxFixture, "160 行 × 26 列")
  await setPrompt(page, FULL_PROMPT)
  const before = listJobDirs()
  const started = performance.now()
  const failure = waitForFailure(page, /科学计算运行时已损坏或无法启动，请重新安装程序/)
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  const message = await failure
  durations.tamperRejection = (performance.now() - started) / 1000
  await page.screenshot({ path: path.join(screenshotsDir, "01-tamper-rejected.png"), fullPage: true })
  const jobs = newJobDirs(before)
  if (jobs.length !== 0) throw new Error(`manifest 动态损坏仍创建了任务目录：${jobs.length}`)
  assertNoReportArtifacts(jobs, "manifest 动态损坏")
  const artifacts = reportArtifactsIn(reportsRoot)
  if (artifacts.length !== 0) throw new Error(`manifest 动态损坏生成了伪报告：${artifacts.join(" | ")}`)
  return { message, jobDirs: jobs, reportArtifacts: 0 }
}

function assertSharedOutcome() {
  if (networkRequests.length) {
    throw new Error(`packaged 分析发生外部网络请求：${networkRequests.map((request) => request.url).join(" | ")}`)
  }
  if (consoleErrors.length) {
    throw new Error(`packaged 渲染进程错误：${consoleErrors.map((entry) => entry.message).join(" | ")}`)
  }
  if (fs.existsSync(knowledgeRoot)) {
    throw new Error(`隔离 packaged E2E 不应写入案例记忆目录：${knowledgeRoot}`)
  }
}

async function executeE2e() {
  const durations = {}
  let launched
  let flow
  let tamper
  let caught
  try {
    if (profile === "tamper") tamper = await tamperManifestProtectedFile()
    launched = releaseSource === "portable"
      ? await launchPortable(`${profile}-primary`)
      : await launchInstalled(`${profile}-primary`)
    durations.coldLaunch = launched.launchSeconds
    if (profile === "nsis") flow = await runNsisFlow(launched.page, durations)
    else if (profile === "portable") flow = await runPortableFlow(launched.page, durations)
    else flow = { reports: {}, failures: { manifestTamper: await runTamperFlow(launched.page, durations) }, science: null }
  } catch (error) {
    caught = error instanceof Error ? error : new Error(String(error))
  } finally {
    if (launched) await closeLaunch(launched)
    if (profile === "tamper") {
      tamperDeletion = { attempted: true, deleted: false, path: configuredAppDir }
      try {
        fs.rmSync(configuredAppDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
        tamperDeletion.deleted = !fs.existsSync(configuredAppDir)
        if (!tamperDeletion.deleted && !caught) caught = new Error(`未删除 tamper 可丢弃副本：${configuredAppDir}`)
      } catch (error) {
        tamperDeletion.error = error.message
        if (!caught) caught = error
      }
    }
  }
  if (caught) throw caught
  assertSharedOutcome()

  return {
    status: "passed",
    syntheticOnly: true,
    releaseSource,
    profile,
    source: launched.identity,
    sourceAppDir: releaseSource === "nsis" ? configuredAppDir : null,
    actualExecutable: launched.identity.actualExecutable,
    portableWrapper: launched.identity.wrapper || null,
    processChain: launched.identity.processChain,
    fixtures: [xlsxFixture, csvFixture, missingColumnFixture],
    reportsRoot,
    screenshotsDir,
    environment: {
      path: `${path.join(process.env.SystemRoot || "C:\\Windows", "System32")};${process.env.SystemRoot || "C:\\Windows"}`,
      pythonHomeCleared: true,
      pythonPathCleared: true,
      sourceVenvUsed: false,
      proxy: "127.0.0.1:9",
      hostResolverBlocked: true,
      externalNetworkRequests: networkRequests,
    },
    durationsSeconds: durations,
    reports: flow.reports,
    science: flow.science,
    failures: flow.failures,
    tamper: profile === "tamper" ? { ...tamper, disposableCopyDeleted: tamperDeletion.deleted } : null,
    fakeReportArtifactsCreated: 0,
    consoleErrors,
  }
}

async function closeAllLiveApps() {
  for (const electronApp of [...liveElectronApps]) {
    try {
      await electronApp.close()
    } catch {
      // Best-effort cleanup after a failed launch or renderer crash.
    } finally {
      liveElectronApps.delete(electronApp)
    }
  }
  for (const launch of [...livePortableLaunches]) {
    await closeLaunch({ kind: "portable", launch }).catch(() => {})
  }
}

async function main() {
  assertSafePaths()
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const historicalBefore = await hashTreeCryptographicallyOnly(historicalOutputsRoot)
  const historicalPayloadBefore = {
    schemaVersion: 1,
    encoding: "UTF-8",
    mode: "SHA-256/size only; contents were not parsed",
    root: historicalOutputsRoot,
    files: historicalBefore,
  }
  const beforeSnapshotPath = path.join(evidenceRoot, "historical-outputs-before.json")
  const beforeBytes = writeJson(beforeSnapshotPath, historicalPayloadBefore)

  let summary
  let caught
  try {
    prepareEvidence()
    summary = await executeE2e()
  } catch (error) {
    caught = error instanceof Error ? error : new Error(String(error))
  } finally {
    await closeAllLiveApps()
  }

  const historicalAfter = await hashTreeCryptographicallyOnly(historicalOutputsRoot)
  const historicalPayloadAfter = {
    schemaVersion: 1,
    encoding: "UTF-8",
    mode: "SHA-256/size only; contents were not parsed",
    root: historicalOutputsRoot,
    files: historicalAfter,
  }
  const afterSnapshotPath = path.join(evidenceRoot, "historical-outputs-after.json")
  const afterBytes = writeJson(afterSnapshotPath, historicalPayloadAfter)
  writeJson(path.join(evidenceRoot, "network-requests.json"), networkRequests)
  const historicalTreeUnchanged = JSON.stringify(historicalBefore) === JSON.stringify(historicalAfter)
  const snapshotBytesIdentical = beforeBytes.equals(afterBytes)
  const snapshotsParseAsJson = Boolean(readUtf8Json(beforeSnapshotPath) && readUtf8Json(afterSnapshotPath))
  if (!historicalTreeUnchanged || !snapshotBytesIdentical || !snapshotsParseAsJson) {
    caught = new Error("历史 outputs 前后 UTF-8 JSON 快照未做到可解析且逐字节一致")
  }

  const historicalOutputs = {
    before: beforeSnapshotPath,
    after: afterSnapshotPath,
    unchanged: historicalTreeUnchanged,
    utf8JsonParsePassed: snapshotsParseAsJson,
    snapshotBytesIdentical,
    beforeSnapshotSha256: sha256Buffer(beforeBytes),
    afterSnapshotSha256: sha256Buffer(afterBytes),
  }

  if (caught) {
    writeJson(path.join(evidenceRoot, "e2e-failure.json"), {
      status: "failed",
      syntheticOnly: true,
      releaseSource,
      profile,
      evidenceRoot,
      error: caught.message,
      stack: caught.stack,
      historicalOutputs,
      externalNetworkRequests: networkRequests,
      consoleErrors,
      tamperDeletion,
    })
    throw caught
  }

  const finalSummary = { ...summary, evidenceRoot, historicalOutputs }
  writeJson(path.join(evidenceRoot, "e2e-summary.json"), finalSummary)
  console.log(JSON.stringify(finalSummary, null, 2))
}

await main()
