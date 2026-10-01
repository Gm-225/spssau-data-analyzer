import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const xlsxPath = path.resolve(process.argv[2] ?? path.join(root, "examples", "synthetic-questionnaire-seed20260717.xlsx"))
const csvPath = path.resolve(process.argv[3] ?? path.join(root, "examples", "synthetic-questionnaire-seed20260717.csv"))
const evidenceDir = path.resolve(process.argv[4] ?? path.join(root, "data", "validation", "T-20260717-08-synthetic", "fixture"))
const seed = 20260717
const sampleSize = 160

function mulberry32(initialSeed) {
  let value = initialSeed >>> 0
  return () => {
    value += 0x6D2B79F5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

const random = mulberry32(seed)
let spareNormal = null
function normal() {
  if (spareNormal !== null) {
    const value = spareNormal
    spareNormal = null
    return value
  }
  const u1 = Math.max(random(), Number.EPSILON)
  const u2 = random()
  const radius = Math.sqrt(-2 * Math.log(u1))
  spareNormal = radius * Math.sin(2 * Math.PI * u2)
  return radius * Math.cos(2 * Math.PI * u2)
}

function standardize(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  const sd = Math.sqrt(variance)
  return values.map((value) => (value - mean) / sd)
}

function likert(value) {
  if (value < -1.15) return 1
  if (value < -0.35) return 2
  if (value < 0.35) return 3
  if (value < 1.15) return 4
  return 5
}

function category(maximum) {
  return Math.floor(random() * maximum) + 1
}

const ppLatent = Array.from({ length: sampleSize }, normal)
const pcLatent = ppLatent.map((pp) => 0.58 * pp + 0.82 * normal())
const piLatent = ppLatent.map((pp) => 0.49 * pp + 0.86 * normal())
const pvLatent = ppLatent.map((pp) => 0.22 * pp + 0.98 * normal())
const aaLatent = ppLatent.map((pp, index) => (
  0.16 * pp
  + 0.42 * pcLatent[index]
  + 0.48 * piLatent[index]
  - 0.18 * pvLatent[index]
  + 0.28 * pp * pvLatent[index]
  + 0.82 * normal()
))

const dimensions = {
  PP: standardize(ppLatent),
  AA: standardize(aaLatent),
  PC: standardize(pcLatent),
  PI: standardize(piLatent),
  PV: standardize(pvLatent),
}

const itemHeaders = {
  PP: [
    "PP1_平台会依据我近期浏览过的内容持续调整广告推荐方式",
    "PP2_我接收到的广告通常能够准确对应当前兴趣和实际需求",
    "PP3_广告中呈现的商品或服务与我的个人偏好保持较高一致性",
    "PP4_平台推送广告时能够体现对我以往选择习惯的持续了解",
  ],
  AA: [
    "AA1_看到这类个性化广告时我会主动跳过或尽快关闭相关页面",
    "AA2_即使广告内容与我有关我仍会减少停留并避免进一步点击",
    "AA3_当平台频繁推送个性化广告时我会刻意回避相关品牌信息",
  ],
  PC: [
    "PC1_我担心平台为投放广告收集了超出必要范围的个人信息",
    "PC2_我担心自己的浏览和购买记录会被用于并未明确说明的用途",
    "PC3_个性化广告让我担心个人数据可能被不同机构共享或滥用",
    "PC4_我不确定平台是否真正采取了足够措施保护我的个人隐私",
  ],
  PI: [
    "PI1_个性化广告经常打断我原本正在进行的浏览或信息获取活动",
    "PI2_平台对我兴趣的判断过于具体时会让我产生被监视的不适感",
    "PI3_同类广告反复出现会让我觉得个人网络空间受到了明显侵扰",
    "PI4_这些广告出现的时间和位置常常使我感到难以主动控制体验",
    "PI5_个性化广告的持续追踪感会影响我对平台整体体验的评价",
  ],
  PV: [
    "PV1_个性化广告能够帮助我更快发现具有实际价值的商品或服务",
    "PV2_与普通广告相比个性化推荐能够减少我筛选信息所花费的时间",
    "PV3_当推荐准确时我认为用部分偏好信息交换便利是可以接受的",
    "PV4_总体而言个性化广告为我的购买决策提供了有帮助的信息",
  ],
}

const headers = ["编号", "性别", "年龄", "受教育程度", "职业", "收入", ...Object.values(itemHeaders).flat()]
const rows = []
for (let index = 0; index < sampleSize; index += 1) {
  const row = [index + 1, category(2), category(4), category(4), category(5), category(4)]
  for (const [dimension, names] of Object.entries(itemHeaders)) {
    for (let itemIndex = 0; itemIndex < names.length; itemIndex += 1) {
      const itemNoise = 0.48 * normal()
      const itemShift = (itemIndex - (names.length - 1) / 2) * 0.035
      row.push(likert(dimensions[dimension][index] + itemNoise + itemShift))
    }
  }
  rows.push(row)
}

function csvCell(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

await fs.mkdir(path.dirname(xlsxPath), { recursive: true })
await fs.mkdir(path.dirname(csvPath), { recursive: true })
await fs.mkdir(evidenceDir, { recursive: true })

const csvText = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
await fs.writeFile(csvPath, `\uFEFF${csvText}`, "utf8")

const workbook = Workbook.create()
const rawSheet = workbook.worksheets.add("synthetic_raw")
rawSheet.getRangeByIndexes(0, 0, rows.length + 1, headers.length).values = [headers, ...rows]
rawSheet.showGridLines = false
rawSheet.freezePanes.freezeRows(1)
rawSheet.getRange("A1:Z1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", name: "Microsoft YaHei", size: 10 },
  verticalAlignment: "center",
  wrapText: true,
  borders: { bottom: { style: "medium", color: "#17365D" } },
}
rawSheet.getRange(`A2:Z${sampleSize + 1}`).format = {
  font: { name: "Microsoft YaHei", size: 10 },
  verticalAlignment: "center",
}
rawSheet.getRange(`A1:A${sampleSize + 1}`).format.columnWidth = 9
rawSheet.getRange(`B1:F${sampleSize + 1}`).format.columnWidth = 14
rawSheet.getRange(`G1:Z${sampleSize + 1}`).format.columnWidth = 28
rawSheet.getRange("A1:Z1").format.rowHeight = 42

const readmeSheet = workbook.worksheets.add("README")
readmeSheet.showGridLines = false
readmeSheet.getRange("A1:B7").values = [
  ["字段", "说明"],
  ["数据性质", "完全合成的问卷测试夹具，不包含客户或真实受访者数据"],
  ["生成种子", seed],
  ["样本量", sampleSize],
  ["模型", "PP 为 X，AA 为 Y，PC/PI 为并行中介，PV 调节 PP→AA 直接路径"],
  ["量表范围", "1-5，所有题项均为整数，无缺失值"],
  ["用途", "仅用于 T-20260717-08 主流程、科学复核和文档渲染验证"],
]
readmeSheet.getRange("A1:B1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", name: "Microsoft YaHei", size: 11 },
  borders: { bottom: { style: "medium", color: "#17365D" } },
}
readmeSheet.getRange("A2:A7").format = { font: { bold: true, name: "Microsoft YaHei" }, fill: "#D9EAF7" }
readmeSheet.getRange("A1:B7").format.verticalAlignment = "center"
readmeSheet.getRange("A1:B7").format.wrapText = true
readmeSheet.getRange("A1:A7").format.columnWidth = 18
readmeSheet.getRange("B1:B7").format.columnWidth = 72
readmeSheet.getRange("A1:B7").format.autofitRows()

const inspect = await workbook.inspect({
  kind: "table",
  sheetId: "synthetic_raw",
  range: "A1:Z8",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 26,
  maxChars: 12000,
})
await fs.writeFile(path.join(evidenceDir, "fixture-inspect.ndjson"), inspect.ndjson, "utf8")

for (const [sheetName, range, fileName] of [
  ["synthetic_raw", "A1:Z15", "synthetic-raw-preview.png"],
  ["README", "A1:B7", "synthetic-readme-preview.png"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.5, format: "png" })
  await fs.writeFile(path.join(evidenceDir, fileName), new Uint8Array(await preview.arrayBuffer()))
}

const output = await SpreadsheetFile.exportXlsx(workbook)
await output.save(xlsxPath)

console.log(JSON.stringify({
  status: "passed",
  seed,
  sampleSize,
  columns: headers.length,
  xlsxPath,
  csvPath,
  evidenceDir,
}, null, 2))
