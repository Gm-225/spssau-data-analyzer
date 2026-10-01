import { _electron as electron } from "playwright-core"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe")
const samplePath = path.resolve(process.env.ANALYZER_E2E_SAMPLE || path.join(root, "examples", "synthetic-questionnaire-seed20260717.xlsx"))
const runStamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
const evidenceRoot = path.resolve(process.env.ANALYZER_EVIDENCE_DIR || path.join(root, "data", "validation", "T-20260717-08-synthetic", `electron-${runStamp}`))
const screenshotDir = path.join(evidenceRoot, "screenshots")
const reportRoot = path.join(evidenceRoot, "reports")
const knowledgeRoot = path.join(evidenceRoot, "knowledge")
const userDataRoot = path.join(evidenceRoot, "user-data")
const GENERATED_REPORT_FILES = [
  "analysis-result.json",
  "问卷数据分析报告.docx",
  "问卷数据分析报告.pdf",
  "研究模型图.png",
  "调节效应图.png",
  "AMOS结构方程模型图.png",
  "amos-engine-result.json",
  "AMOS原始输出.AmosOutput.html",
]

if (!path.basename(samplePath).toLowerCase().includes("synthetic") || path.dirname(samplePath) !== path.join(root, "examples")) {
  throw new Error(`拒绝非 examples/synthetic 样本：${samplePath}`)
}
if (!fs.existsSync(samplePath)) throw new Error(`synthetic 样本不存在：${samplePath}`)
if (fs.existsSync(evidenceRoot)) throw new Error(`证据目录已存在，拒绝覆盖：${evidenceRoot}`)
fs.mkdirSync(screenshotDir, { recursive: true })
fs.mkdirSync(reportRoot, { recursive: true })

function listJobDirs() {
  if (!fs.existsSync(reportRoot)) return []
  return fs.readdirSync(reportRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(reportRoot, entry.name))
}

function newJobDirs(before) {
  const known = new Set(before)
  return listJobDirs().filter((entry) => !known.has(entry))
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase()
}

function directorySnapshot(directory) {
  const entries = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(directory, absolute).replaceAll("\\", "/")
      if (entry.isDirectory()) {
        entries.push({ relative, type: "directory" })
        visit(absolute)
      } else {
        entries.push({ relative, type: "file", bytes: fs.statSync(absolute).size, sha256: sha256(absolute) })
      }
    }
  }
  visit(directory)
  return entries
}

function createRecoveryFixtures() {
  const interruptedJobId = crypto.randomUUID()
  const interruptedJobDir = path.join(reportRoot, interruptedJobId)
  const interruptedInput = JSON.stringify({ syntheticOnly: true, rows: [{ SAT1: 3 }] })
  const interruptedPlan = JSON.stringify({ syntheticOnly: true, confirmation: { confirmed: true } }, null, 2)
  fs.mkdirSync(path.join(interruptedJobDir, ".pipeline-staging"), { recursive: true })
  fs.writeFileSync(path.join(interruptedJobDir, "analysis-plan.json"), interruptedPlan, "utf8")
  fs.writeFileSync(path.join(interruptedJobDir, "input.json"), interruptedInput, "utf8")
  fs.writeFileSync(path.join(interruptedJobDir, ".pipeline-staging", "synthetic-partial.tmp"), "synthetic staging only", "utf8")
  for (const filename of GENERATED_REPORT_FILES) {
    fs.writeFileSync(path.join(interruptedJobDir, filename), `synthetic interrupted artifact: ${filename}`, "utf8")
  }
  const interruptedManifestPath = path.join(interruptedJobDir, "job-manifest.json")
  fs.writeFileSync(interruptedManifestPath, JSON.stringify({
    schemaVersion: 1,
    jobId: interruptedJobId,
    status: "running",
    createdAtUtc: "2026-07-31T00:00:00.000Z",
    completedAtUtc: null,
    app: { name: "AI Data Analyzer", version: "2.1.0", releaseId: "v2.1.0" },
    input: { sha256: crypto.createHash("sha256").update(interruptedInput, "utf8").digest("hex").toUpperCase(), rowCount: 1, columnCount: 1 },
    plan: { sha256: crypto.createHash("sha256").update(interruptedPlan, "utf8").digest("hex").toUpperCase(), schemaVersion: "synthetic" },
    artifacts: [],
    privacy: { inputDisposition: "ephemeral", rawInputRetained: false, rawInputDeletedAtUtc: null, caseMemoryStored: false },
  }, null, 2), "utf8")

  const sentinelJobId = crypto.randomUUID()
  const sentinelJobDir = path.join(reportRoot, sentinelJobId)
  fs.mkdirSync(path.join(sentinelJobDir, ".pipeline-staging"), { recursive: true })
  fs.writeFileSync(path.join(sentinelJobDir, "input.json"), "synthetic historical sentinel input", "utf8")
  fs.writeFileSync(path.join(sentinelJobDir, ".pipeline-staging", "sentinel.tmp"), "do not touch", "utf8")
  fs.writeFileSync(path.join(sentinelJobDir, "analysis-result.json"), "synthetic historical sentinel report", "utf8")
  fs.writeFileSync(path.join(sentinelJobDir, "job-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    jobId: sentinelJobId,
    status: "running",
    app: { version: "2.1.0" },
    privacy: { rawInputRetained: true },
  }, null, 2), "utf8")

  const legacyMarkedJobId = crypto.randomUUID()
  const legacyMarkedJobDir = path.join(reportRoot, legacyMarkedJobId)
  fs.mkdirSync(path.join(legacyMarkedJobDir, ".pipeline-staging"), { recursive: true })
  fs.writeFileSync(path.join(legacyMarkedJobDir, "input.json"), "synthetic old-version sentinel input", "utf8")
  fs.writeFileSync(path.join(legacyMarkedJobDir, ".pipeline-staging", "sentinel.tmp"), "do not touch", "utf8")
  fs.writeFileSync(path.join(legacyMarkedJobDir, "analysis-result.json"), "synthetic old-version sentinel report", "utf8")
  fs.writeFileSync(path.join(legacyMarkedJobDir, "job-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    jobId: legacyMarkedJobId,
    status: "running",
    app: { version: "2.0.1" },
    privacy: { inputDisposition: "ephemeral", rawInputRetained: false },
  }, null, 2), "utf8")

  return {
    interrupted: { jobId: interruptedJobId, jobDir: interruptedJobDir, manifestPath: interruptedManifestPath },
    noMarkerSentinel: { jobId: sentinelJobId, jobDir: sentinelJobDir, before: directorySnapshot(sentinelJobDir) },
    oldVersionSentinel: { jobId: legacyMarkedJobId, jobDir: legacyMarkedJobDir, before: directorySnapshot(legacyMarkedJobDir) },
  }
}

function validateRecoveryFixtures(fixtures) {
  const manifest = JSON.parse(fs.readFileSync(fixtures.interrupted.manifestPath, "utf8"))
  if (manifest.status !== "failed" || manifest.failure?.code !== "INTERRUPTED") {
    throw new Error(`异常退出任务未正确恢复：${JSON.stringify(manifest.failure)}`)
  }
  if (fs.existsSync(path.join(fixtures.interrupted.jobDir, "input.json"))) throw new Error("异常退出任务仍保留临时原始输入")
  if (fs.existsSync(path.join(fixtures.interrupted.jobDir, ".pipeline-staging"))) throw new Error("异常退出任务仍保留 staging")
  for (const filename of GENERATED_REPORT_FILES) {
    if (fs.existsSync(path.join(fixtures.interrupted.jobDir, filename))) throw new Error(`异常退出任务仍保留未完成产物：${filename}`)
  }
  if (manifest.privacy?.inputDisposition !== "ephemeral" || manifest.privacy?.rawInputRetained !== false || !manifest.privacy?.rawInputDeletedAtUtc) {
    throw new Error(`异常退出任务隐私状态错误：${JSON.stringify(manifest.privacy)}`)
  }
  if ((manifest.cleanup?.remainingGeneratedArtifacts || []).length || (manifest.cleanup?.generatedArtifactDeletionFailures || []).length) {
    throw new Error(`异常退出任务清理未完成：${JSON.stringify(manifest.cleanup)}`)
  }
  for (const [label, sentinel] of Object.entries({ noMarker: fixtures.noMarkerSentinel, oldVersion: fixtures.oldVersionSentinel })) {
    const sentinelAfter = directorySnapshot(sentinel.jobDir)
    if (JSON.stringify(sentinelAfter) !== JSON.stringify(sentinel.before)) {
      throw new Error(`${label} sentinel 被恢复逻辑改动`)
    }
  }
  return {
    interruptedJobDir: fixtures.interrupted.jobDir,
    interruptedManifest: fixtures.interrupted.manifestPath,
    interruptedFailureCode: manifest.failure.code,
    inputDeleted: true,
    stagingDeleted: true,
    generatedArtifactsDeleted: GENERATED_REPORT_FILES.length,
    noMarkerSentinelUnchanged: true,
    oldVersionSentinelUnchanged: true,
  }
}

function validateReport(jobDir) {
  const artifacts = {}
  for (const file of GENERATED_REPORT_FILES.slice(0, 3)) {
    const artifact = path.join(jobDir, file)
    if (!fs.existsSync(artifact) || fs.statSync(artifact).size < 1000) {
      throw new Error(`Electron 输出缺失：${artifact}`)
    }
    artifacts[file] = { path: artifact, length: fs.statSync(artifact).size, sha256: sha256(artifact) }
  }
  return artifacts
}

function validateJobManifest(jobDir, expectedStatus) {
  const manifestPath = path.join(jobDir, "job-manifest.json")
  const planPath = path.join(jobDir, "analysis-plan.json")
  const inputPath = path.join(jobDir, "input.json")
  if (!fs.existsSync(manifestPath)) throw new Error(`任务追溯清单缺失：${manifestPath}`)
  if (!fs.existsSync(planPath)) throw new Error(`确认方案缺失：${planPath}`)
  if (fs.existsSync(inputPath)) throw new Error(`临时原始输入未按默认策略删除：${inputPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  if (manifest.status !== expectedStatus) throw new Error(`任务状态异常：${manifest.status} != ${expectedStatus}`)
  if (manifest.app?.version !== "2.1.0") throw new Error(`任务未绑定 2.1.0 版本：${JSON.stringify(manifest.app)}`)
  if (!/^[A-F0-9]{64}$/.test(manifest.input?.sha256 || "")) throw new Error("输入 SHA-256 缺失")
  if (manifest.plan?.sha256 !== sha256(planPath)) throw new Error("确认方案 SHA-256 无法重算")
  if (manifest.privacy?.inputDisposition !== "ephemeral" || manifest.privacy?.rawInputRetained !== false || !manifest.privacy?.rawInputDeletedAtUtc) {
    throw new Error(`原始输入留存状态异常：${JSON.stringify(manifest.privacy)}`)
  }
  if (manifest.privacy?.caseMemoryStored !== false) throw new Error("默认策略不应写入案例记忆")
  for (const artifact of manifest.artifacts || []) {
    const artifactPath = path.resolve(jobDir, artifact.relativePath)
    if (!artifactPath.startsWith(`${path.resolve(jobDir)}${path.sep}`) || !fs.existsSync(artifactPath)) {
      throw new Error(`manifest 产物路径无效：${artifact.relativePath}`)
    }
    if (artifact.sha256 !== sha256(artifactPath) || artifact.bytes !== fs.statSync(artifactPath).size) {
      throw new Error(`manifest 产物哈希或大小不匹配：${artifact.relativePath}`)
    }
  }
  const retainedGeneratedFiles = GENERATED_REPORT_FILES.filter((filename) => fs.existsSync(path.join(jobDir, filename))).sort()
  const trackedGeneratedFiles = (manifest.artifacts || []).map((artifact) => artifact.relativePath).sort()
  if (JSON.stringify(retainedGeneratedFiles) !== JSON.stringify(trackedGeneratedFiles)) {
    throw new Error(`任务目录与 manifest 产物集合不一致：disk=${JSON.stringify(retainedGeneratedFiles)} manifest=${JSON.stringify(trackedGeneratedFiles)}`)
  }
  if (expectedStatus === "succeeded") {
    const roles = new Set((manifest.artifacts || []).map((artifact) => artifact.role))
    for (const requiredRole of ["result", "docx", "pdf"]) {
      if (!roles.has(requiredRole)) throw new Error(`成功任务缺少必需产物角色：${requiredRole}`)
    }
  }
  if (expectedStatus === "failed" && !manifest.failure?.code) throw new Error("失败任务缺少稳定错误码")
  return { path: manifestPath, manifest }
}

function assertNoReportArtifacts(jobDir) {
  for (const file of GENERATED_REPORT_FILES) {
    if (fs.existsSync(path.join(jobDir, file))) throw new Error(`失败任务生成了伪报告：${path.join(jobDir, file)}`)
  }
  if (fs.existsSync(path.join(jobDir, ".pipeline-staging"))) throw new Error(`失败任务仍保留暂存目录：${jobDir}`)
}

const recoveryFixtures = createRecoveryFixtures()
const consoleErrors = []
const stageDurations = {}
const launchStarted = performance.now()
const electronApp = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userDataRoot}`],
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    OPENBLAS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
    ANALYZER_REPORTS_ROOT: reportRoot,
    ANALYZER_KNOWLEDGE_ROOT: knowledgeRoot,
  },
})
stageDurations.launch = (performance.now() - launchStarted) / 1000

try {
  const page = await electronApp.firstWindow()
  const interruptedRecovery = validateRecoveryFixtures(recoveryFixtures)
  const browserWindow = await electronApp.browserWindow(page)
  await browserWindow.evaluate((window) => window.setSize(1440, 900))
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))

  const uploadStarted = performance.now()
  await page.getByRole("button", { name: "数据上传" }).click()
  await page.locator('input[type="file"]').first().setInputFiles(samplePath)
  await page.getByText("160 行 × 26 列", { exact: true }).waitFor({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, "01-upload.png"), fullPage: true })
  stageDurations.upload = (performance.now() - uploadStarted) / 1000

  await page.getByRole("button", { name: "前往数据分析" }).click()
  await page.getByText("自动识别：").waitFor({ timeout: 10_000 })
  for (const [id, expectedName] of [["PP", "感知个性化"], ["AA", "广告回避"], ["PC", "隐私担忧"], ["PI", "感知侵扰"], ["PV", "广告感知价值"]]) {
    const actualName = await page.getByLabel(`${id} 维度名称`).inputValue()
    if (actualName !== expectedName) throw new Error(`维度识别错误：${id}=${actualName}`)
  }
  const responsiveLayouts = []
  for (const requested of [
    { width: 900, height: 600 },
    { width: 1280, height: 860 },
    { width: 1440, height: 900 },
  ]) {
    await browserWindow.evaluate((window, size) => window.setSize(size.width, size.height), requested)
    await page.waitForTimeout(200)
    const actual = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    }))
    if (actual.documentWidth > actual.viewportWidth + 1 || actual.bodyWidth > actual.viewportWidth + 1) {
      throw new Error(`AI 助手页在 ${requested.width}x${requested.height} 窗口横向溢出：document=${actual.documentWidth}, body=${actual.bodyWidth}, viewport=${actual.viewportWidth}`)
    }
    responsiveLayouts.push({ requested, actual, horizontalOverflow: false })
    if (requested.width === 900) {
      await page.screenshot({ path: path.join(screenshotDir, "02-analysis-plan-900x600.png"), fullPage: true })
    }
  }
  const layout = responsiveLayouts.at(-1).actual

  await page.getByRole("button", { name: "手动分析", exact: true }).click()
  await page.getByText("变量列表", { exact: true }).waitFor({ timeout: 10_000 })
  await browserWindow.evaluate((window) => window.setSize(900, 600))
  await page.waitForTimeout(200)
  const longVariableRow = page.locator('[title^="PP1"]').first()
  await longVariableRow.waitFor({ timeout: 10_000 })
  const manualVariableLayout = await longVariableRow.evaluate((element) => {
    const label = element.querySelector("span")
    const rowRect = element.getBoundingClientRect()
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      rowRight: rowRect.right,
      labelClientWidth: label?.clientWidth ?? 0,
      labelScrollWidth: label?.scrollWidth ?? 0,
      labelTextOverflow: label ? getComputedStyle(label).textOverflow : null,
    }
  })
  if (manualVariableLayout.documentWidth > manualVariableLayout.viewportWidth + 1 || manualVariableLayout.rowRight > manualVariableLayout.viewportWidth + 1) {
    throw new Error(`手动分析页长变量越界：${JSON.stringify(manualVariableLayout)}`)
  }
  if (manualVariableLayout.labelScrollWidth <= manualVariableLayout.labelClientWidth || manualVariableLayout.labelTextOverflow !== "ellipsis") {
    throw new Error(`手动分析页长变量未正确省略：${JSON.stringify(manualVariableLayout)}`)
  }
  const manualJobsBeforeBlockedMethod = listJobDirs()
  await page.getByRole("button", { name: /验证性因子分析\(CFA\)/ }).click()
  await page.getByText("尚未进入可信主线", { exact: true }).waitFor()
  const blockedRunButton = page.getByRole("button", { name: "暂不可运行", exact: true })
  if (!(await blockedRunButton.isDisabled())) throw new Error("未验证的手动 CFA 仍可执行")
  if (newJobDirs(manualJobsBeforeBlockedMethod).length) throw new Error("选择受限手动方法不应创建科学任务目录")
  await page.screenshot({ path: path.join(screenshotDir, "02-manual-analysis-900x600.png"), fullPage: true })
  await page.getByRole("button", { name: "数据分析", exact: true }).click()
  await page.getByText("自动识别：").waitFor({ timeout: 10_000 })
  await browserWindow.evaluate((window) => window.setSize(1440, 900))
  await page.waitForTimeout(200)
  const fullPrompt = "请做完整分析：PP为自变量、AA为因变量，PC和PI为并行中介，PV调节PP→AA直接路径；包括频数、描述统计、信度、效度、相关、Bootstrap中介和调节分析。"
  await page.getByLabel("分析需求").fill(fullPrompt)
  await page.getByText(/模型分配：.*X=PP.*Y=AA/).waitFor()
  const runButton = page.getByRole("button", { name: "一键分析", exact: true })
  if (!(await runButton.isDisabled())) throw new Error("未确认方案时一键分析按钮未锁定")
  await page.getByLabel("性别 人口学字段").check()
  await page.getByText("人口学频数", { exact: true }).waitFor()
  await page.getByRole("button", { name: "确认分析方案", exact: true }).click()
  if (await runButton.isDisabled()) throw new Error("确认有效方案后仍无法执行")
  await page.getByLabel("报告标题").fill("广告个性化感知对消费者回避的影响（P0合成验证）")
  if (!(await runButton.isDisabled())) throw new Error("修改方案字段后未重新锁定执行")
  await page.getByRole("button", { name: "确认分析方案", exact: true }).click()
  if (await runButton.isDisabled()) throw new Error("重新确认方案后仍无法执行")
  await page.screenshot({ path: path.join(screenshotDir, "02-analysis-plan.png"), fullPage: true })

  const beforeFull = listJobDirs()
  const fullStarted = performance.now()
  await runButton.click()
  await page.getByRole("button", { name: "打开Word" }).waitFor({ timeout: 180_000 })
  await page.getByRole("button", { name: "打开PDF" }).waitFor()
  await page.getByText("1、数据质量与变量识别").waitFor()
  await page.getByText(/系统根据列名前缀和分析要求自动识别变量/).waitFor()
  stageDurations.fullAnalysis = (performance.now() - fullStarted) / 1000
  await page.mouse.move(1400, 80)
  await page.screenshot({ path: path.join(screenshotDir, "03-results-top.png") })
  await page.screenshot({ path: path.join(screenshotDir, "04-results-full.png"), fullPage: true })
  const fullJobs = newJobDirs(beforeFull)
  if (fullJobs.length !== 1) throw new Error(`完整分析新任务目录数量异常：${fullJobs.length}`)
  const fullArtifacts = validateReport(fullJobs[0])
  const fullManifest = validateJobManifest(fullJobs[0], "succeeded")

  await page.getByRole("button", { name: "数据分析" }).click()
  await page.getByLabel("分析需求").fill("只做问卷信度分析")
  await page.getByText("执行计划：", { exact: true }).waitFor()
  await page.getByText("信度", { exact: true }).waitFor()
  if (!(await page.getByRole("button", { name: "一键分析", exact: true }).isDisabled())) throw new Error("修改提示词后未锁定方案")
  await page.getByRole("button", { name: "确认分析方案", exact: true }).click()
  const beforeLimited = listJobDirs()
  const limitedStarted = performance.now()
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  await page.getByText("2、信度检验").waitFor({ timeout: 180_000 })
  stageDurations.limitedAnalysis = (performance.now() - limitedStarted) / 1000
  for (const forbidden of ["频数分析", "描述统计", "主成分结构检查（PCA\\+Varimax）", "相关性分析", "并行中介与调节作用", "综合结论"]) {
    if (await page.getByText(new RegExp(`^\\d+、${forbidden}$`)).count()) {
      throw new Error(`限定章节在界面出现未请求模块：${forbidden}`)
    }
  }
  await page.screenshot({ path: path.join(screenshotDir, "05-reliability-only.png"), fullPage: true })
  const limitedJobs = newJobDirs(beforeLimited)
  if (limitedJobs.length !== 1) throw new Error(`限定分析新任务目录数量异常：${limitedJobs.length}`)
  const limitedArtifacts = validateReport(limitedJobs[0])
  const limitedManifest = validateJobManifest(limitedJobs[0], "succeeded")
  const limitedJson = JSON.parse(fs.readFileSync(path.join(limitedJobs[0], "analysis-result.json"), "utf8"))
  const limitedSections = limitedJson.tables.filter((item) => item.type === "text" && /^\d+、/.test(item.title)).map((item) => item.title)
  if (JSON.stringify(limitedSections) !== JSON.stringify(["1、数据质量与变量识别", "2、信度检验"])) {
    throw new Error(`限定分析 JSON 章节越界：${JSON.stringify(limitedSections)}`)
  }

  await page.getByRole("button", { name: "数据分析" }).click()
  await page.getByLabel("分析需求").fill("请做完整分析：PP和PV为自变量，AA为因变量")
  const genericModelLabel = await page.getByText("模型分配：", { exact: true }).locator("..").textContent()
  if (!genericModelLabel?.includes("X=PP+PV → Y=AA")) throw new Error(`通用回归模型预览错误：${genericModelLabel}`)
  await page.getByRole("button", { name: "确认分析方案", exact: true }).click()
  const beforeGenericRegression = listJobDirs()
  const genericRegressionStarted = performance.now()
  await page.getByRole("button", { name: "一键分析", exact: true }).click()
  await page.getByText(/^\d+、多元回归与假设检验$/).waitFor({ timeout: 180_000 })
  stageDurations.genericRegression = (performance.now() - genericRegressionStarted) / 1000
  const genericRegressionJobs = newJobDirs(beforeGenericRegression)
  if (genericRegressionJobs.length !== 1) throw new Error(`通用回归新任务目录数量异常：${genericRegressionJobs.length}`)
  const genericRegressionArtifacts = validateReport(genericRegressionJobs[0])
  const genericRegressionManifest = validateJobManifest(genericRegressionJobs[0], "succeeded")
  const genericRegressionJson = JSON.parse(fs.readFileSync(path.join(genericRegressionJobs[0], "analysis-result.json"), "utf8"))
  if (JSON.stringify(genericRegressionJson.raw?.regression?.predictors) !== JSON.stringify(["PP", "PV"]) || genericRegressionJson.raw?.regression?.outcome !== "AA") {
    throw new Error(`通用回归模型执行错误：${JSON.stringify(genericRegressionJson.raw?.regression)}`)
  }

  await page.getByRole("button", { name: "数据分析" }).click()
  await page.getByLabel("分析需求").fill("请根据这份数据写一首宣传诗")
  const beforeInvalid = listJobDirs()
  const invalidStarted = performance.now()
  const blockingIssue = page.getByTestId("plan-blocking-issues").getByText(/未识别到可执行的分析需求/)
  await blockingIssue.waitFor({ timeout: 10_000 })
  const invalidDemandMessage = await blockingIssue.textContent()
  if (!(await page.getByRole("button", { name: "确认分析方案", exact: true }).isDisabled())) throw new Error("无效需求仍可确认方案")
  if (!(await page.getByRole("button", { name: "一键分析", exact: true }).isDisabled())) throw new Error("无效需求仍可启动分析")
  stageDurations.invalidDemand = (performance.now() - invalidStarted) / 1000
  await page.screenshot({ path: path.join(screenshotDir, "06-invalid-demand.png"), fullPage: true })
  const invalidJobs = newJobDirs(beforeInvalid)
  if (invalidJobs.length !== 0) throw new Error(`无效需求在 UI 阻断后仍创建任务目录：${invalidJobs.length}`)

  const beforeFailedValidation = listJobDirs()
  const failedValidationResponse = await page.evaluate(async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      SAT1: index === 0 ? 99 : 3,
      SAT2: 2 + (index % 3),
      LOY1: 1 + (index % 5),
      LOY2: 2 + (index % 4),
    }))
    const plan = {
      schemaVersion: "2.0",
      planId: "electron-failed-validation",
      title: "Electron 失败关闭验证",
      sampleIdColumn: null,
      excludedColumns: [],
      demographics: [],
      scale: { min: 1, max: 5, labels: { "1": "1", "2": "2", "3": "3", "4": "4", "5": "5" }, missingPolicy: "dimension-mean-requires-all-items", confirmed: true },
      dimensions: [
        { id: "SAT", name: "满意度", columnPrefix: "SAT", expectedItems: 2, items: ["SAT1", "SAT2"], reverseItems: [], reverseItemsConfirmed: true },
        { id: "LOY", name: "忠诚度", columnPrefix: "LOY", expectedItems: 2, items: ["LOY1", "LOY2"], reverseItems: [], reverseItemsConfirmed: true },
      ],
      model: { type: "none", controls: [], centering: [], bootstrapSamples: 5000, confidenceLevel: 0.95 },
      analysisOrder: ["data-quality", "item-descriptive"],
      humanConfirmations: [],
      confirmation: { confirmed: true, confirmedAtUtc: "2026-07-31T00:00:00.000Z" },
    }
    try {
      await window.analysisBridge.runQuestionnaireAnalysis({ headers: ["SAT1", "SAT2", "LOY1", "LOY2"], rows, prompt: "", plan })
      return { succeeded: true, message: "" }
    } catch (error) {
      return { succeeded: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  if (failedValidationResponse.succeeded || !failedValidationResponse.message.includes("超出量表范围")) {
    throw new Error(`失败关闭错误不明确：${JSON.stringify(failedValidationResponse)}`)
  }
  const failedValidationJobs = newJobDirs(beforeFailedValidation)
  if (failedValidationJobs.length !== 1) throw new Error(`失败关闭任务目录数量异常：${failedValidationJobs.length}`)
  assertNoReportArtifacts(failedValidationJobs[0])
  const failedValidationManifest = validateJobManifest(failedValidationJobs[0], "failed")

  if (fs.existsSync(knowledgeRoot)) throw new Error("隔离 E2E 不应写入案例记忆目录")
  if (consoleErrors.length) throw new Error(`渲染进程错误：${consoleErrors.join(" | ")}`)

  const summary = {
    status: "passed",
    syntheticOnly: true,
    samplePath,
    evidenceRoot,
    layout,
    responsiveLayouts,
    manualVariableLayout: { ...manualVariableLayout, longVariableTruncated: true, horizontalOverflow: false },
    stageDurations,
    screenshots: screenshotDir,
    fullReportDir: fullJobs[0],
    limitedReportDir: limitedJobs[0],
    genericRegressionReportDir: genericRegressionJobs[0],
    failedValidationReportDir: failedValidationJobs[0],
    interruptedRecovery,
    limitedSections,
    fullArtifacts,
    limitedArtifacts,
    genericRegressionArtifacts,
    manifests: {
      full: fullManifest.path,
      limited: limitedManifest.path,
      genericRegression: genericRegressionManifest.path,
      failedValidation: failedValidationManifest.path,
    },
    invalidReportArtifacts: 0,
    invalidDemandMessage,
    failedValidationMessage: failedValidationResponse.message,
    caseMemoryWritten: false,
    consoleErrors,
  }
  const summaryPath = path.join(evidenceRoot, "e2e-summary.json")
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8")
  console.log(JSON.stringify({ ...summary, fullArtifacts: Object.keys(fullArtifacts), limitedArtifacts: Object.keys(limitedArtifacts), genericRegressionArtifacts: Object.keys(genericRegressionArtifacts) }, null, 2))
} finally {
  await electronApp.close()
}
