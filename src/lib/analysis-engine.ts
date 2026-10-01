// SPSSAU Analysis Engine
// Pure TypeScript analysis functions using jStat

declare const jStat: any
declare const XLSX: any
declare const Papa: any

// ============================================================
// Types
// ============================================================

export interface DataTable {
  headers: string[]
  rows: Record<string, unknown>[]
}

export interface AnalysisVariables {
  [zoneId: string]: string[]
}

export interface AnalysisResult {
  methodId: string
  methodName: string
  timestamp: number
  tables: ResultTable[]
  interpretation?: string
}

export interface ResultTable {
  title: string
  type: "table" | "text" | "chart"
  headers: string[]
  rows: (string | number)[][]
  footnotes?: string[]
}

// ============================================================
// Helpers
// ============================================================

function toNum(v: unknown): number {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    return isNaN(n) ? NaN : n
  }
  return NaN
}

function getValidRows(data: DataTable, vars: string[]): Record<string, unknown>[] {
  return data.rows.filter((row) =>
    vars.every((v) => {
      const val = row[v]
      return val !== null && val !== undefined && val !== ""
    })
  )
}

function getCol(data: DataTable, col: string): number[] {
  return data.rows.map((r) => toNum(r[col])).filter((v) => isFinite(v))
}

function fmt(v: number, decimals = 3): string {
  if (!isFinite(v)) return "-"
  return v.toFixed(decimals)
}

function fmtP(v: number): string {
  if (!isFinite(v)) return "-"
  if (v < 0.001) return "<0.001"
  return v.toFixed(3)
}

function stars(p: number): string {
  if (!isFinite(p)) return ""
  if (p < 0.001) return "***"
  if (p < 0.01) return "**"
  if (p < 0.05) return "*"
  return ""
}

function mean(arr: number[]): number {
  if (arr.length === 0) return NaN
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function std(arr: number[]): number {
  if (arr.length < 2) return NaN
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0)
}

// ============================================================
// Descriptive Analysis
// ============================================================

export function performDescriptive(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["analysis-variables"] || []
  if (vars.length === 0) throw new Error("请选择分析变量")

  const headers = ["变量", "样本量", "平均值", "标准差", "最小值", "最大值", "中位数", "峰度", "偏度"]
  const rows: (string | number)[][] = []

  for (const v of vars) {
    const vals = getCol(data, v).sort((a, b) => a - b)
    if (vals.length === 0) continue
    const n = vals.length
    const m = mean(vals)
    const s = std(vals)
    const med = n % 2 === 0
      ? (vals[n / 2 - 1] + vals[n / 2]) / 2
      : vals[Math.floor(n / 2)]
    // Kurtosis
    const kurt = vals.reduce((s, x) => s + ((x - m) / s) ** 4, 0) / n - 3
    // Skewness
    const skew = vals.reduce((s, x) => s + ((x - m) / s) ** 3, 0) / n

    rows.push([v, n, fmt(m), fmt(s), fmt(vals[0]), fmt(vals[n - 1]), fmt(med), fmt(kurt), fmt(skew)])
  }

  return {
    methodId: "descriptive",
    methodName: "描述性分析",
    timestamp: Date.now(),
    tables: [{ title: "描述统计量", type: "table", headers, rows }],
  }
}

// ============================================================
// Frequency Analysis
// ============================================================

export function performFrequency(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["frequency-variables"] || []
  if (vars.length === 0) throw new Error("请选择分析变量")

  const tables: ResultTable[] = []

  for (const v of vars) {
    const vals = data.rows.map((r) => String(r[v] ?? ""))
    const freq: Record<string, number> = {}
    vals.forEach((val) => { freq[val] = (freq[val] || 0) + 1 })
    const total = vals.length
    const entries = Object.entries(freq).sort((a, b) => b[1] - a[1])

    const headers = ["取值", "频数", "百分比(%)", "累计百分比(%)"]
    const rows: (string | number)[][] = []
    let cum = 0
    for (const [val, count] of entries) {
      const pct = (count / total) * 100
      cum += pct
      rows.push([val, count, fmt(pct, 1), fmt(cum, 1)])
    }
    rows.push(["合计", total, "100.0", ""])

    tables.push({ title: `${v} - 频数分布`, type: "table", headers, rows })
  }

  return {
    methodId: "frequency",
    methodName: "频数分析",
    timestamp: Date.now(),
    tables,
  }
}

// ============================================================
// Correlation Analysis
// ============================================================

export function performCorrelation(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["analysis-variables"] || []
  if (vars.length < 2) throw new Error("请至少选择2个分析变量")

  const cols = vars.map((v) => getCol(data, v))
  const validIdx: number[] = []
  for (let i = 0; i < (cols[0]?.length || 0); i++) {
    if (cols.every((c) => isFinite(c[i]))) validIdx.push(i)
  }

  const headers = ["变量", ...vars]
  const rows: (string | number)[][] = []

  for (let i = 0; i < vars.length; i++) {
    const row: (string | number)[] = [vars[i]]
    for (let j = 0; j < vars.length; j++) {
      if (i === j) {
        row.push("1.000")
        continue
      }
      const xi = validIdx.map((k) => cols[i][k])
      const xj = validIdx.map((k) => cols[j][k])
      const mi = mean(xi), mj = mean(xj)
      let cov = 0, vi = 0, vj = 0
      for (let k = 0; k < xi.length; k++) {
        cov += (xi[k] - mi) * (xj[k] - mj)
        vi += (xi[k] - mi) ** 2
        vj += (xj[k] - mj) ** 2
      }
      const r = cov / Math.sqrt(vi * vj)
      row.push(isFinite(r) ? fmt(r) : "-")
    }
    rows.push(row)
  }

  return {
    methodId: "correlation",
    methodName: "相关分析",
    timestamp: Date.now(),
    tables: [{ title: "Pearson相关系数矩阵", type: "table", headers, rows }],
  }
}
// ============================================================
// Independent T-Test
// ============================================================

export function performIndependentTTest(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const yVars = variables["y-variable"] || []
  const xVar = (variables["x-variable"] || [])[0]
  if (yVars.length === 0 || !xVar) throw new Error("请选择检验变量和分组变量")

  const tables: ResultTable[] = []

  for (const yVar of yVars) {
    const valid = data.rows.filter((r) => r[yVar] != null && r[yVar] !== "" && r[xVar] != null && r[xVar] !== "")
    const groups: Record<string, number[]> = {}
    valid.forEach((r) => {
      const g = String(r[xVar])
      if (!groups[g]) groups[g] = []
      groups[g].push(toNum(r[yVar]))
    })
    const groupNames = Object.keys(groups)
    if (groupNames.length < 2) {
      tables.push({ title: `${yVar} - 分组不足`, type: "text", headers: [], rows: [[`分组变量 "${xVar}" 至少需要2个不同取值`]] })
      continue
    }

    // Group stats
    const statsHeaders = ["分组", "样本量", "平均值", "标准差", "标准误"]
    const statsRows: (string | number)[][] = []
    for (const g of groupNames) {
      const vals = groups[g].filter((v) => isFinite(v))
      const m = mean(vals)
      const s = std(vals)
      statsRows.push([g, vals.length, fmt(m), fmt(s), fmt(s / Math.sqrt(vals.length))])
    }
    tables.push({ title: `${yVar} - 组统计量`, type: "table", headers: statsHeaders, rows: statsRows })

    // T-test for first two groups
    const g1 = groups[groupNames[0]].filter((v) => isFinite(v))
    const g2 = groups[groupNames[1]].filter((v) => isFinite(v))
    const m1 = mean(g1), m2 = mean(g2)
    const s1 = std(g1), s2 = std(g2)
    const n1 = g1.length, n2 = g2.length

    // Welch's t-test
    const se = Math.sqrt(s1 * s1 / n1 + s2 * s2 / n2)
    const t = (m1 - m2) / se
    const df = Math.pow(s1 * s1 / n1 + s2 * s2 / n2, 2) /
      (Math.pow(s1 * s1 / n1, 2) / (n1 - 1) + Math.pow(s2 * s2 / n2, 2) / (n2 - 1))

    // Approximate p-value using jStat if available, otherwise normal approx
    let p: number
    try {
      p = (1 - jStat.studentt.cdf(Math.abs(t), df)) * 2
    } catch {
      p = 2 * (1 - normalCDF(Math.abs(t)))
    }

    const testHeaders = ["指标", "值"]
    tables.push({
      title: `${yVar} - 独立样本T检验 (${groupNames[0]} vs ${groupNames[1]})`,
      type: "table",
      headers: testHeaders,
      rows: [
        ["t值", fmt(t)],
        ["自由度(df)", fmt(df, 1)],
        ["p值", fmtP(p)],
        ["均值差", fmt(m1 - m2)],
        ["差值的标准误", fmt(se)],
        ["显著性", p < 0.05 ? `显著${stars(p)}` : "不显著"],
      ],
    })
  }

  return { methodId: "ttest-independent", methodName: "独立样本T检验", timestamp: Date.now(), tables }
}

// ============================================================
// Paired T-Test
// ============================================================

export function performPairedTTest(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const pair1 = variables["pair1"] || []
  const pair2 = variables["pair2"] || []
  if (pair1.length === 0 || pair2.length === 0) throw new Error("请选择配对变量")

  const tables: ResultTable[] = []
  const minLen = Math.min(pair1.length, pair2.length)

  for (let i = 0; i < minLen; i++) {
    const v1 = pair1[i], v2 = pair2[i]
    const valid = data.rows.filter((r) => {
      const a = toNum(r[v1]), b = toNum(r[v2])
      return isFinite(a) && isFinite(b)
    })
    const diffs = valid.map((r) => toNum(r[v1]) - toNum(r[v2]))
    const md = mean(diffs)
    const sd = std(diffs)
    const n = diffs.length
    const se = sd / Math.sqrt(n)
    const t = md / se
    const df = n - 1
    let p: number
    try { p = (1 - jStat.studentt.cdf(Math.abs(t), df)) * 2 }
    catch { p = 2 * (1 - normalCDF(Math.abs(t))) }

    tables.push({
      title: `配对T检验: ${v1} - ${v2}`,
      type: "table",
      headers: ["指标", "值"],
      rows: [
        ["配对差值均值", fmt(md)],
        ["差值标准差", fmt(sd)],
        ["标准误", fmt(se)],
        ["t值", fmt(t)],
        ["自由度", String(df)],
        ["p值", fmtP(p)],
        ["显著性", p < 0.05 ? `显著${stars(p)}` : "不显著"],
      ],
    })
  }

  return { methodId: "ttest-paired", methodName: "配对样本T检验", timestamp: Date.now(), tables }
}

// ============================================================
// One-way ANOVA
// ============================================================

export function performANOVA(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const yVars = variables["y-variable"] || []
  const xVar = (variables["x-variable"] || [])[0]
  if (yVars.length === 0 || !xVar) throw new Error("请选择因变量和分组变量")

  const tables: ResultTable[] = []

  for (const yVar of yVars) {
    const valid = data.rows.filter((r) => r[yVar] != null && r[yVar] !== "" && r[xVar] != null && r[xVar] !== "")
    const groups: Record<string, number[]> = {}
    valid.forEach((r) => {
      const g = String(r[xVar])
      if (!groups[g]) groups[g] = []
      groups[g].push(toNum(r[yVar]))
    })

    const groupNames = Object.keys(groups)
    if (groupNames.length < 2) {
      tables.push({ title: `${yVar} - ANOVA需要至少2个分组`, type: "text", headers: [], rows: [] })
      continue
    }

    // Group descriptives
    const descHeaders = ["分组", "样本量", "均值", "标准差"]
    const descRows: (string | number)[][] = []
    let grandTotal = 0, grandN = 0
    for (const g of groupNames) {
      const vals = groups[g].filter((v) => isFinite(v))
      descRows.push([g, vals.length, fmt(mean(vals)), fmt(std(vals))])
      grandTotal += sum(vals)
      grandN += vals.length
    }
    tables.push({ title: `${yVar} - 描述统计`, type: "table", headers: descHeaders, rows: descRows })

    // ANOVA table
    const grandMean = grandTotal / grandN
    let ssb = 0, ssw = 0
    const k = groupNames.length
    for (const g of groupNames) {
      const vals = groups[g].filter((v) => isFinite(v))
      const gm = mean(vals)
      ssb += vals.length * (gm - grandMean) ** 2
      ssw += vals.reduce((s, v) => s + (v - gm) ** 2, 0)
    }
    const dfb = k - 1
    const dfw = grandN - k
    const msb = ssb / dfb
    const msw = ssw / dfw
    const F = msb / msw
    let p: number
    try { p = 1 - jStat.centralF.cdf(F, dfb, dfw) }
    catch { p = NaN }

    tables.push({
      title: `${yVar} - 方差分析表`,
      type: "table",
      headers: ["来源", "平方和(SS)", "自由度(df)", "均方(MS)", "F值", "p值"],
      rows: [
        ["组间", fmt(ssb, 2), String(dfb), fmt(msb, 2), fmt(F), fmtP(p)],
        ["组内", fmt(ssw, 2), String(dfw), fmt(msw, 2), "", ""],
        ["总计", fmt(ssb + ssw, 2), String(grandN - 1), "", "", ""],
      ],
    })
  }

  return { methodId: "anova", methodName: "方差分析", timestamp: Date.now(), tables }
}

// ============================================================
// Chi-Square Test
// ============================================================

export function performChiSquare(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const xVars = variables["x-variable"] || []
  const yVar = (variables["y-variable"] || [])[0]
  if (xVars.length === 0 || !yVar) throw new Error("请选择X变量和Y变量")

  const tables: ResultTable[] = []

  for (const xVar of xVars) {
    const valid = data.rows.filter((r) => r[xVar] != null && r[xVar] !== "" && r[yVar] != null && r[yVar] !== "")
    if (valid.length === 0) continue

    // Build contingency table
    const xCats = [...new Set(valid.map((r) => String(r[xVar])))]
    const yCats = [...new Set(valid.map((r) => String(r[yVar])))]
    const observed: Record<string, Record<string, number>> = {}
    const rowTotals: Record<string, number> = {}
    const colTotals: Record<string, number> = {}
    const total = valid.length

    for (const x of xCats) { observed[x] = {}; rowTotals[x] = 0 }
    for (const y of yCats) { colTotals[y] = 0 }

    valid.forEach((r) => {
      const x = String(r[xVar]), y = String(r[yVar])
      observed[x][y] = (observed[x][y] || 0) + 1
      rowTotals[x]++
      colTotals[y]++
    })

    // Build cross-tabulation
    const crossHeaders = ["", ...yCats, "合计"]
    const crossRows: (string | number)[][] = []
    for (const x of xCats) {
      const row: (string | number)[] = [x]
      for (const y of yCats) row.push(observed[x][y] || 0)
      row.push(rowTotals[x])
      crossRows.push(row)
    }
    const totalRow: (string | number)[] = ["合计"]
    for (const y of yCats) totalRow.push(colTotals[y])
    totalRow.push(total)
    crossRows.push(totalRow)
    tables.push({ title: `${xVar} × ${yVar} 交叉表`, type: "table", headers: crossHeaders, rows: crossRows })

    // Chi-square
    let chi2 = 0
    for (const x of xCats) {
      for (const y of yCats) {
        const o = observed[x][y] || 0
        const e = (rowTotals[x] * colTotals[y]) / total
        if (e > 0) chi2 += (o - e) ** 2 / e
      }
    }
    const df = (xCats.length - 1) * (yCats.length - 1)
    let p: number
    try { p = 1 - jStat.chisquare.cdf(chi2, df) }
    catch { p = NaN }
    const cramerV = Math.sqrt(chi2 / (total * Math.min(xCats.length - 1, yCats.length - 1)))

    tables.push({
      title: "卡方检验结果",
      type: "table",
      headers: ["指标", "值"],
      rows: [
        ["χ²", fmt(chi2)],
        ["自由度(df)", String(df)],
        ["p值", fmtP(p)],
        ["Cramér's V", fmt(cramerV)],
        ["显著性", p < 0.05 ? `显著${stars(p)}` : "不显著"],
      ],
    })
  }

  return { methodId: "chi-square", methodName: "卡方检验", timestamp: Date.now(), tables }
}

// ============================================================
// Linear Regression
// ============================================================

export function performLinearRegression(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const yVar = (variables["y-variable"] || [])[0]
  const xVars = variables["x-variables"] || []
  if (!yVar || xVars.length === 0) throw new Error("请选择因变量和自变量")

  const allVars = [yVar, ...xVars]
  const valid = data.rows.filter((r) => allVars.every((v) => toNum(r[v]) !== null && isFinite(toNum(r[v]))))
  const n = valid.length
  const Y = valid.map((r) => toNum(r[yVar]))
  const X = valid.map((r) => [1, ...xVars.map((v) => toNum(r[v]))])  // intercept column

  // OLS: β = (X'X)^(-1) X'Y
  const k = xVars.length + 1
  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  const XtY: number[] = Array(k).fill(0)

  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      XtX[i][j] = X.reduce((s, row) => s + row[i] * row[j], 0)
    }
    XtY[i] = X.reduce((s, row) => s + row[i] * Y[X.indexOf(row)], 0)
  }

  const beta = solveLinear(XtX, XtY)

  // Predictions & residuals
  const Yhat = X.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0))
  const residuals = Y.map((y, i) => y - Yhat[i])
  const RSS = residuals.reduce((s, r) => s + r * r, 0)
  const TSS = Y.reduce((s, y) => s + (y - mean(Y)) ** 2, 0)
  const R2 = 1 - RSS / TSS
  const adjR2 = 1 - (1 - R2) * (n - 1) / (n - k)
  const sigma2 = RSS / (n - k)
  const F = ((TSS - RSS) / (k - 1)) / sigma2

  // Standard errors
  let XtX_inv: number[][] | null = null
try { XtX_inv = invertMatrix(XtX) } catch {}
  const se = XtX_inv ? XtX_inv.map((row, i) => Math.sqrt(sigma2 * row[i])) : Array(k).fill(NaN)
  const tVals = beta.map((b, i) => b / se[i])
  let pVals: number[]
  try { pVals = tVals.map((t) => 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - k))) }
  catch { pVals = tVals.map(() => NaN) }

  // Model summary
  const summaryHeaders = ["指标", "值"]
  const summaryRows = [
    ["R", fmt(Math.sqrt(R2))],
    ["R²", fmt(R2)],
    ["调整R²", fmt(adjR2)],
    ["标准估计误差", fmt(Math.sqrt(sigma2))],
    ["F值", fmt(F)],
    ["样本量", String(n)],
  ]

  // Coefficients table
  const coefHeaders = ["变量", "非标准化系数(B)", "标准误(SE)", "标准化系数(β)", "t值", "p值", "显著性"]
  const coefRows: (string | number)[][] = [
    ["(常量)", fmt(beta[0]), fmt(se[0]), "-", fmt(tVals[0]), fmtP(pVals[0]), stars(pVals[0])],
  ]
  for (let i = 1; i < k; i++) {
    const sx = std(valid.map((r) => toNum(r[xVars[i - 1]])))
    const sy = std(Y)
    const stdBeta = sx > 0 && sy > 0 ? beta[i] * sx / sy : NaN
    coefRows.push([xVars[i - 1], fmt(beta[i]), fmt(se[i]), fmt(stdBeta), fmt(tVals[i]), fmtP(pVals[i]), stars(pVals[i])])
  }

  return {
    methodId: "linear-regression",
    methodName: "线性回归",
    timestamp: Date.now(),
    tables: [
      { title: "模型摘要", type: "table", headers: summaryHeaders, rows: summaryRows },
      { title: "回归系数", type: "table", headers: coefHeaders, rows: coefRows },
    ],
  }
}

// ============================================================
// Reliability Analysis (Cronbach's Alpha)
// ============================================================

export function performReliability(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["analysis-variables"] || []
  if (vars.length < 2) throw new Error("请至少选择2个分析变量进行信度分析")

  const valid = data.rows.filter((r) => vars.every((v) => {
    const n = toNum(r[v])
    return isFinite(n)
  }))

  const n = valid.length
  const k = vars.length
  const cols = vars.map((v) => valid.map((r) => toNum(r[v])))

  // Item variances
  const itemVars = cols.map((c) => {
    const m = mean(c)
    return c.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)
  })

  // Total score variance
  const totals = valid.map((_, i) => cols.reduce((s, c) => s + c[i], 0))
  const totalVar = totals.reduce((s, t) => s + (t - mean(totals)) ** 2, 0) / (n - 1)

  // Cronbach's alpha
  const alpha = (k / (k - 1)) * (1 - sum(itemVars) / totalVar)

  // Alpha if item deleted
  const alphaIfDeleted = vars.map((_, idx) => {
    const otherCols = cols.filter((_, i) => i !== idx)
    const otherTotals = valid.map((_, i) => otherCols.reduce((s, c) => s + c[i], 0))
    const otherVar = otherTotals.reduce((s, t) => s + (t - mean(otherTotals)) ** 2, 0) / (n - 1)
    const otherItemVars = itemVars.filter((_, i) => i !== idx)
    return ((k - 1) / (k - 2)) * (1 - sum(otherItemVars) / otherVar)
  })

  // Item-total correlations
  const itemTotalCorr = vars.map((_, idx) => {
    const otherTotals = valid.map((_, i) => cols.filter((_, j) => j !== idx).reduce((s, c) => s + c[i], 0))
    const ci = cols[idx]
    const mo = mean(otherTotals), mc = mean(ci)
    let cov = 0, vo = 0, vc = 0
    for (let i = 0; i < n; i++) { cov += (ci[i] - mc) * (otherTotals[i] - mo); vo += (otherTotals[i] - mo) ** 2; vc += (ci[i] - mc) ** 2 }
    return cov / Math.sqrt(vo * vc)
  })

  const itemHeaders = ["变量", "删除项后的标度均值", "删除项后的标度方差", "修正的项与总计相关性", "删除项后的Cronbach's α"]
  const itemRows = vars.map((v, i) => [
    v,
    fmt(mean(totals) - mean(cols[i])),
    fmt(totalVar + itemVars[i] - 2 * Math.sqrt(itemVars[i] * totalVar) * (itemTotalCorr[i] || 0)),
    fmt(itemTotalCorr[i]),
    fmt(alphaIfDeleted[i]),
  ])

  return {
    methodId: "reliability",
    methodName: "信度分析",
    timestamp: Date.now(),
    tables: [
      { title: "可靠性统计", type: "table", headers: ["Cronbach's α", "项数", "样本量"], rows: [[fmt(alpha), String(k), String(n)]] },
      { title: "项总统计量", type: "table", headers: itemHeaders, rows: itemRows },
    ],
  }
}

// ============================================================
// Matrix helpers for regression
// ============================================================

function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length
  const aug = A.map((row, i) => [...row, b[i]])
  // Gaussian elimination
  for (let i = 0; i < n; i++) {
    let maxRow = i
    for (let j = i + 1; j < n; j++) { if (Math.abs(aug[j][i]) > Math.abs(aug[maxRow][i])) maxRow = j }
    if (Math.abs(aug[maxRow][i]) < 1e-10) throw new Error("矩阵不可逆")
    const _tmp = aug[i]; aug[i] = aug[maxRow]; aug[maxRow] = _tmp
    for (let j = i + 1; j < n; j++) {
      const factor = aug[j][i] / aug[i][i]
      for (let k = i; k <= n; k++) aug[j][k] -= factor * aug[i][k]
    }
  }
  // Back substitution
  const x: number[] = Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n] / aug[i][i]
    for (let j = i - 1; j >= 0; j--) aug[j][n] -= aug[j][i] * x[i]
  }
  return x
}

function invertMatrix(A: number[][]): number[][] {
  const n = A.length
  const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let i = 0; i < n; i++) {
    let maxRow = i
    for (let j = i + 1; j < n; j++) { if (Math.abs(aug[j][i]) > Math.abs(aug[maxRow][i])) maxRow = j }
    if (Math.abs(aug[maxRow][i]) < 1e-10) throw new Error("矩阵不可逆")
    const _tmp = aug[i]; aug[i] = aug[maxRow]; aug[maxRow] = _tmp
    const pivot = aug[i][i]
    for (let k = 0; k < 2 * n; k++) aug[i][k] /= pivot
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const factor = aug[j][i]
      for (let k = 0; k < 2 * n; k++) aug[j][k] -= factor * aug[i][k]
    }
  }
  return aug.map((row) => row.slice(n))
}

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

// ============================================================
// Binary Logistic Regression
// ============================================================

export function performBinaryLogit(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const yVar = (variables["y-variable"] || [])[0]
  const xVars = variables["x-variables"] || []
  if (!yVar || xVars.length === 0) throw new Error("请选择因变量(0/1)和自变量")

  const allVars = [yVar, ...xVars]
  const valid = data.rows.filter((r) => {
    const y = toNum(r[yVar])
    return (y === 0 || y === 1) && xVars.every((v) => isFinite(toNum(r[v])))
  })
  const n = valid.length

  // Simple IRLS for logistic regression
  const k = xVars.length + 1
  let beta: number[] = Array(k).fill(0)
  const X = valid.map((r) => [1, ...xVars.map((v) => toNum(r[v]))])
  const Y = valid.map((r) => toNum(r[yVar]))

  // IRLS iterations
  for (let iter = 0; iter < 25; iter++) {
    const eta = X.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0))
    const mu = eta.map((e) => 1 / (1 + Math.exp(-e)))
    const W: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
    for (let i = 0; i < n; i++) W[i][i] = mu[i] * (1 - mu[i])
    const z = eta.map((e, i) => e + (Y[i] - mu[i]) / (mu[i] * (1 - mu[i]) + 1e-10))

    const XtWX: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
    const XtWz: number[] = Array(k).fill(0)
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        XtWX[i][j] = X.reduce((s, row, idx) => s + row[i] * W[idx][idx] * row[j], 0)
      }
      XtWz[i] = X.reduce((s, row, idx) => s + row[i] * W[idx][idx] * z[idx], 0)
    }
    const delta = solveLinear(XtWX, XtWz)
    if (!delta) break
    beta = delta
  }

  // Model fit
  const eta = X.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0))
  const mu = eta.map((e) => 1 / (1 + Math.exp(-e)))
  const logLik = Y.reduce((s, y, i) => s + y * Math.log(mu[i] + 1e-10) + (1 - y) * Math.log(1 - mu[i] + 1e-10), 0)
  const nullLogLik = n * (mean(Y) * Math.log(mean(Y) + 1e-10) + (1 - mean(Y)) * Math.log(1 - mean(Y) + 1e-10))
  const mcfaddenR2 = 1 - logLik / nullLogLik

  // Standard errors from Hessian
  const XtWX_inv = invertMatrix(Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) =>
      X.reduce((s, row, idx) => s + row[i] * mu[idx] * (1 - mu[idx]) * row[j], 0)
    )
  ))

  const se2 = XtWX_inv ? XtWX_inv.map((row, i) => Math.sqrt(row[i])) : Array(k).fill(NaN)
  const zVals = beta.map((b, i) => b / se2[i])
  const oddsRatios = beta.map((b) => Math.exp(b))

  const coefHeaders = ["变量", "系数(B)", "标准误(SE)", "Wald χ²", "p值", "OR(Exp(B))", "显著性"]
  const coefRows: (string | number)[][] = [
    ["(常量)", fmt(beta[0]), fmt(se2[0]), fmt(zVals[0] ** 2), fmtP(2 * (1 - normalCDF(Math.abs(zVals[0])))), fmt(oddsRatios[0]), stars(2 * (1 - normalCDF(Math.abs(zVals[0]))))],
  ]
  for (let i = 1; i < k; i++) {
    const p = 2 * (1 - normalCDF(Math.abs(zVals[i])))
    coefRows.push([xVars[i - 1], fmt(beta[i]), fmt(se2[i]), fmt(zVals[i] ** 2), fmtP(p), fmt(oddsRatios[i]), stars(p)])
  }

  return {
    methodId: "binary-logit",
    methodName: "二元Logit回归",
    timestamp: Date.now(),
    tables: [
      { title: "模型拟合", type: "table", headers: ["指标", "值"], rows: [["-2 Log Likelihood", fmt(-2 * logLik)], ["McFadden R²", fmt(mcfaddenR2)], ["样本量", String(n)]] },
      { title: "回归系数", type: "table", headers: coefHeaders, rows: coefRows },
    ],
  }
}

// ============================================================
// Partial Correlation
// ============================================================

export function performPartialCorrelation(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["variables"] || []
  const controlVars = variables["control"] || []
  if (vars.length < 2) throw new Error("请至少选择2个分析变量")
  if (controlVars.length === 0) throw new Error("请选择控制变量")

  const allVars = [...vars, ...controlVars]
  const valid = data.rows.filter((r) => allVars.every((v) => isFinite(toNum(r[v]))))
  const cols = allVars.map((v) => valid.map((r) => toNum(r[v])))
  const n = valid.length

  // Compute full correlation matrix
  const m = allVars.length
  const corrMat: number[][] = Array.from({ length: m }, () => Array(m).fill(0))
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      if (i === j) { corrMat[i][j] = 1; continue }
      const mi = mean(cols[i]), mj = mean(cols[j])
      let cov = 0, vi = 0, vj = 0
      for (let k = 0; k < n; k++) { cov += (cols[i][k] - mi) * (cols[j][k] - mj); vi += (cols[i][k] - mi) ** 2; vj += (cols[j][k] - mj) ** 2 }
      corrMat[i][j] = cov / Math.sqrt(vi * vj)
    }
  }

  // Compute precision matrix (inverse of correlation)
  const precMat = invertMatrix(corrMat)
  if (!precMat) throw new Error("矩阵不可逆")

  // Partial correlations = -p_ij / sqrt(p_ii * p_jj)
  const headers = ["变量", ...vars]
  const rows: (string | number)[][] = []
  for (let i = 0; i < vars.length; i++) {
    const row: (string | number)[] = [vars[i]]
    for (let j = 0; j < vars.length; j++) {
      if (i === j) { row.push("1.000"); continue }
      const pcorr = -precMat[i][j] / Math.sqrt(precMat[i][i] * precMat[j][j])
      row.push(fmt(pcorr))
    }
    rows.push(row)
  }

  return {
    methodId: "partial-correlation",
    methodName: "偏相关分析",
    timestamp: Date.now(),
    tables: [{ title: `偏相关系数矩阵 (控制: ${controlVars.join(", ")})`, type: "table", headers, rows }],
  }
}

// ============================================================
// EFA - Exploratory Factor Analysis
// ============================================================

export function performEFA(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["variables"] || []
  if (vars.length < 3) throw new Error("请至少选择3个变量进行因子分析")

  const valid = data.rows.filter((r) => vars.every((v) => isFinite(toNum(r[v]))))
  const n = valid.length
  const k = vars.length
  const cols = vars.map((v) => valid.map((r) => toNum(r[v])))

  // Standardize
  const zCols = cols.map((c) => {
    const m = mean(c), s = std(c)
    return c.map((v) => (v - m) / (s || 1))
  })

  // Correlation matrix
  const corrMat: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      corrMat[i][j] = zCols[i].reduce((s, _, idx) => s + zCols[i][idx] * zCols[j][idx], 0) / (n - 1)
    }
  }

  // KMO
  // Partial correlation matrix
  const precMat = invertMatrix(corrMat)
  let kmoNum = 0, kmoDen = 0
  if (precMat) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        if (i === j) continue
        const pcorr = -precMat[i][j] / Math.sqrt(precMat[i][i] * precMat[j][j])
        kmoNum += corrMat[i][j] ** 2
        kmoDen += corrMat[i][j] ** 2 + pcorr ** 2
      }
    }
  }
  const kmo = kmoDen > 0 ? kmoNum / kmoDen : 0

  // Bartlett's test
  const detR = determinant(corrMat)
  const bartlettChi = detR > 0 ? -(n - 1 - (2 * k + 5) / 6) * Math.log(detR) : 0
  const bartlettDf = k * (k - 1) / 2
  let bartlettP: number
  try { bartlettP = 1 - jStat.chisquare.cdf(bartlettChi, bartlettDf) }
  catch { bartlettP = NaN }

  // Eigenvalue decomposition using power iteration (simplified)
  const eigen = powerIteration(corrMat, Math.min(k, 6))

  // Total variance explained
  const totalVar = sum(eigen.values)
  const varHeaders = ["成分", "特征值", "方差百分比(%)", "累计百分比(%)"]
  const varRows: (string | number)[][] = []
  let cumPct = 0
  eigen.values.forEach((v, i) => {
    const pct = (v / totalVar) * 100
    cumPct += pct
    varRows.push([String(i + 1), fmt(v, 3), fmt(pct, 1), fmt(cumPct, 1)])
  })

  // Rotation (varimax simplified) and loadings
  const nFactors = eigen.values.filter((v) => v > 1).length || Math.min(3, k)
  const loadings: number[][] = Array.from({ length: k }, () => Array(nFactors).fill(0))
  for (let j = 0; j < nFactors; j++) {
    const ev = eigen.vectors[j]
    const scale = Math.sqrt(eigen.values[j])
    for (let i = 0; i < k; i++) {
      loadings[i][j] = ev[i] * scale
    }
  }

  const loadHeaders = ["变量", ...Array.from({ length: nFactors }, (_, i) => `因子${i + 1}`), "共同度"]
  const loadRows: (string | number)[][] = vars.map((v, i) => {
    const comm = loadings[i].reduce((s, l) => s + l * l, 0)
    return [v, ...loadings[i].map((l) => fmt(l)), fmt(comm)]
  })

  return {
    methodId: "efa",
    methodName: "探索性因子分析",
    timestamp: Date.now(),
    tables: [
      { title: "KMO和Bartlett检验", type: "table", headers: ["指标", "值"], rows: [["KMO", fmt(kmo)], ["Bartlett χ²", fmt(bartlettChi)], ["自由度", String(bartlettDf)], ["p值", fmtP(bartlettP)]] },
      { title: "总方差解释", type: "table", headers: varHeaders, rows: varRows },
      { title: "因子载荷矩阵", type: "table", headers: loadHeaders, rows: loadRows },
    ],
  }
}

// ============================================================
// Mediation (Baron & Kenny + Sobel test)
// ============================================================

export function performMediation(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const xVars = variables["x-variable"] || []
  const mVars = variables["m-variable"] || []
  const yVar = (variables["y-variable"] || [])[0]
  if (xVars.length === 0 || mVars.length === 0 || !yVar) throw new Error("请选择X、M、Y变量")

  const tables: ResultTable[] = []

  for (const xVar of xVars) {
    for (const mVar of mVars) {
      const allVars = [xVar, mVar, yVar]
      const valid = data.rows.filter((r) => allVars.every((v) => isFinite(toNum(r[v]))))
      const n = valid.length

      // Step 1: X -> Y (c path)
      const c = simpleReg(valid, xVar, yVar)
      // Step 2: X -> M (a path)
      const a = simpleReg(valid, xVar, mVar)
      // Step 3: X + M -> Y (c' and b paths)
      const partial = multiReg(valid, [xVar, mVar], yVar)
      const cPrime = partial[0], b = partial[1]

      // Sobel test
      const sobelSE = Math.sqrt(a.beta ** 2 * b.se ** 2 + b.beta ** 2 * a.se ** 2)
      const sobelZ = (a.beta * b.beta) / sobelSE
      const sobelP = 2 * (1 - normalCDF(Math.abs(sobelZ)))
      const indirectEffect = a.beta * b.beta

      tables.push({
        title: `中介效应: ${xVar} → ${mVar} → ${yVar}`,
        type: "table",
        headers: ["路径", "系数", "标准误", "t值", "p值", "显著性"],
        rows: [
          [`c: ${xVar}→${yVar}(总效应)`, fmt(c.beta), fmt(c.se), fmt(c.t), fmtP(c.p), stars(c.p)],
          [`a: ${xVar}→${mVar}`, fmt(a.beta), fmt(a.se), fmt(a.t), fmtP(a.p), stars(a.p)],
          [`b: ${mVar}→${yVar}`, fmt(b.beta), fmt(b.se), fmt(b.t), fmtP(b.p), stars(b.p)],
          [`c': ${xVar}→${yVar}(直接)`, fmt(cPrime.beta), fmt(cPrime.se), fmt(cPrime.t), fmtP(cPrime.p), stars(cPrime.p)],
          ["间接效应(a×b)", fmt(indirectEffect), "", "", "", ""],
          ["Sobel Z", fmt(sobelZ), "", fmtP(sobelP), stars(sobelP), ""],
        ],
      })
    }
  }

  return { methodId: "mediation", methodName: "中介作用", timestamp: Date.now(), tables }
}

// ============================================================
// Moderation
// ============================================================

export function performModeration(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const xVar = (variables["x-variable"] || [])[0]
  const mVar = (variables["m-variable"] || [])[0]
  const yVar = (variables["y-variable"] || [])[0]
  if (!xVar || !mVar || !yVar) throw new Error("请选择X、M、Y变量")

  const allVars = [xVar, mVar, yVar]
  const valid = data.rows.filter((r) => allVars.every((v) => isFinite(toNum(r[v]))))
  const n = valid.length

  // Center variables
  const xVals = valid.map((r) => toNum(r[xVar]))
  const mVals = valid.map((r) => toNum(r[mVar]))
  const yVals = valid.map((r) => toNum(r[yVar]))
  const mx = mean(xVals), mm = mean(mVals)
  const xc = xVals.map((v) => v - mx)
  const mc = mVals.map((v) => v - mm)
  const interaction = xc.map((x, i) => x * mc[i])

  // Regression with interaction term
  const Y = yVals
  const X = [Array(n).fill(1), xc, mc, interaction]
  const k = 4
  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  const XtY: number[] = Array(k).fill(0)
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      XtX[i][j] = X[j].reduce((s, _, idx) => s + X[i][idx] * X[j][idx], 0)
    }
    XtY[i] = X[i].reduce((s, _, idx) => s + X[i][idx] * Y[idx], 0)
  }
  const beta = solveLinear(XtX, XtY)

  const Yhat = Array.from({ length: n }, (_, i) => beta[0] + beta[1] * xc[i] + beta[2] * mc[i] + beta[3] * interaction[i])
  const RSS = Y.reduce((s, y, i) => s + (y - Yhat[i]) ** 2, 0)
  const TSS = Y.reduce((s, y) => s + (y - mean(Y)) ** 2, 0)
  const R2 = 1 - RSS / TSS
  const sigma2 = RSS / (n - k)
  let XtX_inv: number[][] | null = null
try { XtX_inv = invertMatrix(XtX) } catch {}
  const se = XtX_inv ? XtX_inv.map((row, i) => Math.sqrt(sigma2 * row[i])) : Array(k).fill(NaN)
  const tVals = beta.map((b, i) => b / se[i])
  let pVals: number[]
  try { pVals = tVals.map((t) => 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - k))) }
  catch { pVals = tVals.map(() => NaN) }

  return {
    methodId: "moderation",
    methodName: "调节作用",
    timestamp: Date.now(),
    tables: [{
      title: `调节效应: ${xVar} × ${mVar} → ${yVar}`,
      type: "table",
      headers: ["变量", "系数", "标准误", "t值", "p值", "显著性"],
      rows: [
        ["(常量)", fmt(beta[0]), fmt(se[0]), fmt(tVals[0]), fmtP(pVals[0]), stars(pVals[0])],
        [`${xVar}(中心化)`, fmt(beta[1]), fmt(se[1]), fmt(tVals[1]), fmtP(pVals[1]), stars(pVals[1])],
        [`${mVar}(中心化)`, fmt(beta[2]), fmt(se[2]), fmt(tVals[2]), fmtP(pVals[2]), stars(pVals[2])],
        [`${xVar}×${mVar}(交互)`, fmt(beta[3]), fmt(se[3]), fmt(tVals[3]), fmtP(pVals[3]), stars(pVals[3])],
        ["R²", fmt(R2), "", "", "", ""],
      ],
    }],
  }
}

// ============================================================
// Simple helpers for mediation/moderation
// ============================================================

interface RegResult { beta: number; se: number; t: number; p: number }

function simpleReg(data: Record<string, unknown>[], xVar: string, yVar: string): RegResult {
  const n = data.length
  const X = data.map((r) => toNum(r[xVar]))
  const Y = data.map((r) => toNum(r[yVar]))
  const mx = mean(X), my = mean(Y)
  let cov = 0, vx = 0
  for (let i = 0; i < n; i++) { cov += (X[i] - mx) * (Y[i] - my); vx += (X[i] - mx) ** 2 }
  const beta = cov / vx
  const alpha = my - beta * mx
  const Yhat = X.map((x) => alpha + beta * x)
  const RSS = Y.reduce((s, y, i) => s + (y - Yhat[i]) ** 2, 0)
  const se = Math.sqrt(RSS / (n - 2) / vx)
  const t = beta / se
  let p: number
  try { p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - 2)) }
  catch { p = NaN }
  return { beta, se, t, p }
}

function multiReg(data: Record<string, unknown>[], xVars: string[], yVar: string): RegResult[] {
  const n = data.length
  const k = xVars.length + 1
  const Y = data.map((r) => toNum(r[yVar]))
  const Xmat = data.map((r) => [1, ...xVars.map((v) => toNum(r[v]))])
  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  const XtY: number[] = Array(k).fill(0)
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) XtX[i][j] = Xmat.reduce((s, row) => s + row[i] * row[j], 0)
    XtY[i] = Xmat.reduce((s, row) => s + row[i] * Y[Xmat.indexOf(row)], 0)
  }
  const beta = solveLinear(XtX, XtY) || Array(k).fill(0)
  const Yhat = Xmat.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0))
  const RSS = Y.reduce((s, y, i) => s + (y - Yhat[i]) ** 2, 0)
  const sigma2 = RSS / (n - k)
  const XtX_inv = invertMatrix(XtX)
  return xVars.map((_, i) => {
    const se = XtX_inv ? Math.sqrt(sigma2 * XtX_inv[i + 1][i + 1]) : NaN
    const t = se > 0 ? beta[i + 1] / se : NaN
    let p: number
    try { p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), n - k)) }
    catch { p = NaN }
    return { beta: beta[i + 1], se, t, p }
  })
}

// Matrix helpers
function determinant(mat: number[][]): number {
  const n = mat.length
  if (n === 1) return mat[0][0]
  if (n === 2) return mat[0][0] * mat[1][1] - mat[0][1] * mat[1][0]
  let det = 0
  for (let j = 0; j < n; j++) {
    const sub = mat.slice(1).map((row) => row.filter((_, k) => k !== j))
    det += (j % 2 === 0 ? 1 : -1) * mat[0][j] * determinant(sub)
  }
  return det
}

function powerIteration(mat: number[][], numEigen: number): { values: number[]; vectors: number[][] } {
  const n = mat.length
  const values: number[] = []
  const vectors: number[][] = []
  let A = mat.map((row) => [...row])

  for (let e = 0; e < numEigen; e++) {
    // Deterministic initialization keeps repeated automated reports reproducible.
    let v = Array.from({ length: n }, (_, index) => 1 + index / Math.max(n, 1))
    let lambda = 0
    for (let iter = 0; iter < 100; iter++) {
      const Av = Array(n).fill(0)
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) Av[i] += A[i][j] * v[j]
      }
      const norm = Math.sqrt(Av.reduce((s, x) => s + x * x, 0))
      if (norm < 1e-10) break
      v = Av.map((x) => x / norm)
      const newLambda = v.reduce((s, vi, i) => s + vi * Av[i], 0)
      if (Math.abs(newLambda - lambda) < 1e-8) break
      lambda = newLambda
    }
    values.push(lambda)
    vectors.push(v)
    // Deflate
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        A[i][j] -= lambda * v[i] * v[j]
      }
    }
  }
  return { values, vectors }
}

// ============================================================
// IPA Analysis (Importance-Performance Analysis)
// ============================================================

export function performIPA(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const impVars = variables["importance"] || []
  const perfVars = variables["performance"] || []
  if (impVars.length === 0 || perfVars.length === 0) throw new Error("请选择重要性变量和表现变量")

  const minLen = Math.min(impVars.length, perfVars.length)
  const tables: ResultTable[] = []

  const quadHeaders = ["指标", "重要性均值", "表现均值", "差距(I-P)", "象限"]
  const quadRows: (string | number)[][] = []

  for (let i = 0; i < minLen; i++) {
    const impVals = data.rows.map((r) => toNum(r[impVars[i]])).filter((v) => isFinite(v))
    const perfVals = data.rows.map((r) => toNum(r[perfVars[i]])).filter((v) => isFinite(v))
    const impM = mean(impVals)
    const perfM = mean(perfVals)

    // Determine quadrant based on overall means
    const allImp = impVars.flatMap((v) => data.rows.map((r) => toNum(r[v])).filter((x) => isFinite(x)))
    const allPerf = perfVars.flatMap((v) => data.rows.map((r) => toNum(r[v])).filter((x) => isFinite(x)))
    const grandImp = mean(allImp)
    const grandPerf = mean(allPerf)

    let quadrant = ""
    if (impM >= grandImp && perfM >= grandPerf) quadrant = "优势区(保持)"
    else if (impM >= grandImp && perfM < grandPerf) quadrant = "改进区(重点改进)"
    else if (impM < grandImp && perfM >= grandPerf) quadrant = "维持区(可能过度)"
    else quadrant = "机会区(低优先)"

    quadRows.push([impVars[i], fmt(impM), fmt(perfM), fmt(impM - perfM), quadrant])
  }

  tables.push({ title: "IPA分析结果", type: "table", headers: quadHeaders, rows: quadRows })

  // Add interpretation
  const interpretationHeaders = ["象限", "策略建议"]
  tables.push({
    title: "IPA策略解读",
    type: "table",
    headers: interpretationHeaders,
    rows: [
      ["优势区(高重要性+高表现)", "继续保持现有优势"],
      ["改进区(高重要性+低表现)", "亟需改进，集中资源提升"],
      ["维持区(低重要性+高表现)", "可能资源配置过度"],
      ["机会区(低重要性+低表现)", "低优先改进项"],
    ],
  })

  return { methodId: "ipa", methodName: "IPA分析", timestamp: Date.now(), tables }
}

// ============================================================
// Cluster Analysis (K-means simplified)
// ============================================================

export function performCluster(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["variables"] || []
  if (vars.length < 2) throw new Error("请至少选择2个聚类变量")

  const valid = data.rows.filter((r) => vars.every((v) => isFinite(toNum(r[v]))))
  const n = valid.length

  // Standardize
  const cols = vars.map((v) => {
    const vals = valid.map((r) => toNum(r[v]))
    const m = mean(vals), s = std(vals)
    return vals.map((x) => (x - m) / (s || 1))
  })

  // Simple K-means with k=3
  const k = Math.min(3, n)
  let centroids: number[][] = Array.from({ length: k }, () =>
    Array.from({ length: vars.length }, () => Math.random() * 2 - 1)
  )
  let assignments: number[] = Array(n).fill(0)

  for (let iter = 0; iter < 20; iter++) {
    // Assign
    let changed = false
    for (let i = 0; i < n; i++) {
      let minDist = Infinity, bestCluster = 0
      for (let c = 0; c < k; c++) {
        const dist = centroids[c].reduce((s, cv, j) => s + (cols[j][i] - cv) ** 2, 0)
        if (dist < minDist) { minDist = dist; bestCluster = c }
      }
      if (assignments[i] !== bestCluster) { changed = true; assignments[i] = bestCluster }
    }
    if (!changed && iter > 0) break

    // Update centroids
    centroids = Array.from({ length: k }, () => Array(vars.length).fill(0))
    const counts = Array(k).fill(0)
    for (let i = 0; i < n; i++) {
      counts[assignments[i]]++
      for (let j = 0; j < vars.length; j++) {
        centroids[assignments[i]][j] += cols[j][i]
      }
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) centroids[c] = centroids[c].map((v) => v / counts[c])
    }
  }

  // Cluster sizes
  const sizes = Array(k).fill(0)
  assignments.forEach((c) => sizes[c]++)

  // Cluster means (on original scale)
  const origCentroids: number[][] = Array.from({ length: k }, () => Array(vars.length).fill(0))
  const origCounts = Array(k).fill(0)
  for (let i = 0; i < n; i++) {
    origCounts[assignments[i]]++
    for (let j = 0; j < vars.length; j++) {
      origCentroids[assignments[i]][j] += toNum(valid[i][vars[j]])
    }
  }
  for (let c = 0; c < k; c++) {
    if (origCounts[c] > 0) origCentroids[c] = origCentroids[c].map((v) => v / origCounts[c])
  }

  const clusterHeaders = ["聚类", "样本量", "占比(%)", ...vars.map((v) => `${v}(均值)`)]
  const clusterRows: (string | number)[][] = Array.from({ length: k }, (_, c) => [
    `聚类${c + 1}`,
    sizes[c],
    fmt((sizes[c] / n) * 100, 1),
    ...origCentroids[c].map((v) => fmt(v)),
  ])

  return {
    methodId: "cluster",
    methodName: "聚类分析",
    timestamp: Date.now(),
    tables: [{ title: "K-means聚类结果 (k=" + k + ")", type: "table", headers: clusterHeaders, rows: clusterRows }],
  }
}

// ============================================================
// Validity Analysis (KMO + Bartlett)
// ============================================================

export function performValidity(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["analysisVars"] || variables["validity-vars"] || []
  if (vars.length < 3) throw new Error("请至少选择3个分析项")

  const valid = data.rows.filter((r) => vars.every((v) => isFinite(toNum(r[v]))))
  const n = valid.length
  const k = vars.length
  const cols = vars.map((v) => valid.map((r) => toNum(r[v])))

  // Correlation matrix
  const zCols = cols.map((c) => { const m = mean(c), s = std(c); return c.map((v) => (v - m) / (s || 1)) })
  const corrMat: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      corrMat[i][j] = zCols[i].reduce((s, _, idx) => s + zCols[i][idx] * zCols[j][idx], 0) / (n - 1)

  // Anti-image correlation (partial correlation) for KMO
  const precMat = invertMatrix(corrMat)
  let kmoNum = 0, kmoDen = 0
  const kmoPerItem: number[] = []
  if (precMat) {
    for (let i = 0; i < k; i++) {
      let itemNum = 0, itemDen = 0
      for (let j = 0; j < k; j++) {
        if (i === j) continue
        const pcorr = -precMat[i][j] / Math.sqrt(precMat[i][i] * precMat[j][j])
        itemNum += corrMat[i][j] ** 2
        itemDen += corrMat[i][j] ** 2 + pcorr ** 2
      }
      const itemKMO = itemDen > 0 ? itemNum / itemDen : 0
      kmoPerItem.push(itemKMO)
      kmoNum += itemNum
      kmoDen += itemDen
    }
  }
  const kmo = kmoDen > 0 ? kmoNum / kmoDen : 0

  // Bartlett
  const detR = determinant(corrMat)
  const bartlettChi = detR > 0 ? -(n - 1 - (2 * k + 5) / 6) * Math.log(Math.max(detR, 1e-10)) : 0
  const bartlettDf = k * (k - 1) / 2
  let bartlettP: number
  try { bartlettP = 1 - jStat.chisquare.cdf(bartlettChi, bartlettDf) }
  catch { bartlettP = NaN }

  // Eigenvalues for variance explained
  const eigen = powerIteration(corrMat, Math.min(k, 6))
  const totalVar = sum(eigen.values)

  const evalHeaders = ["成分", "特征值", "方差百分比(%)", "累计百分比(%)"]
  const evalRows: (string | number)[][] = []
  let cumPct = 0
  eigen.values.forEach((v, i) => {
    const pct = (v / totalVar) * 100
    cumPct += pct
    evalRows.push([String(i + 1), fmt(v, 3), fmt(pct, 1), fmt(cumPct, 1)])
  })

  const kmoHeaders = ["分析项", "KMO值"]
  const kmoRows: (string | number)[][] = vars.map((v, i) => [v, fmt(kmoPerItem[i] || 0)])

  let kmoInterpretation = ""
  if (kmo >= 0.9) kmoInterpretation = "非常适合因子分析"
  else if (kmo >= 0.8) kmoInterpretation = "适合因子分析"
  else if (kmo >= 0.7) kmoInterpretation = "一般适合因子分析"
  else if (kmo >= 0.6) kmoInterpretation = "勉强适合因子分析"
  else kmoInterpretation = "不适合因子分析"

  return {
    methodId: "validity",
    methodName: "效度分析",
    timestamp: Date.now(),
    tables: [
      { title: "KMO和Bartlett检验", type: "table", headers: ["指标", "值"], rows: [["KMO值", fmt(kmo)], ["解读", kmoInterpretation], ["Bartlett χ²", fmt(bartlettChi)], ["自由度", String(bartlettDf)], ["p值", fmtP(bartlettP)]] },
      { title: "各项KMO值", type: "table", headers: kmoHeaders, rows: kmoRows },
      { title: "总方差解释", type: "table", headers: evalHeaders, rows: evalRows },
    ],
  }
}

// ============================================================
// CFA - Confirmatory Factor Analysis (ML estimation)
// ============================================================

function cfaLogGamma(x: number): number {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - cfaLogGamma(1 - x)
  x -= 1
  let a = 0.99999999999980993
  const t = x + 7.5
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

function cfaLowerRegGamma(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum
    for (let n = 0; n < 500; n++) {
      ap++
      del *= x / ap
      sum += del
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - cfaLogGamma(a))
  }
  // continued fraction for Q(a,x), return 1-Q
  const tiny = 1e-300
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < tiny) d = tiny
    c = b + an / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-14) break
  }
  const q = Math.exp(-x + a * Math.log(x) - cfaLogGamma(a)) * h
  return 1 - q
}

function cfaChiSqCDF(x: number, df: number): number {
  if (x <= 0 || df <= 0) return 0
  return cfaLowerRegGamma(df / 2, x / 2)
}

function cfaChol(A: number[][]): number[][] | null {
  const n = A.length
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (s <= 1e-12) return null
        L[i][j] = Math.sqrt(s)
      } else {
        L[i][j] = s / L[j][j]
      }
    }
  }
  return L
}

function cfaCholSolve(L: number[][], b: number[]): number[] {
  const n = L.length
  const y = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]
    x[i] = s / L[i][i]
  }
  return x
}

function cfaInvertFromChol(L: number[][]): number[][] {
  const n = L.length
  const cols: number[][] = []
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0)
    e[i] = 1
    cols.push(cfaCholSolve(L, e))
  }
  return cols[0].map((_, r) => cols.map((c) => c[r]))
}

interface CfaModel {
  Lambda: number[][]
  Phi: number[][]
  Theta: number[][]
  Sigma: number[][]
}

export function performCFA(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  // Collect factors from dynamic zones (factor1, factor2, ...)
  const factorKeys = Object.keys(variables)
    .filter((k) => /^factor\d+$/.test(k))
    .sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10))

  const factorDefs: { name: string; vars: string[] }[] = []
  const allVars: string[] = []
  for (const key of factorKeys) {
    const vars = variables[key] || []
    if (vars.length > 0) {
      factorDefs.push({ name: `因子${key.slice(6)}`, vars })
      allVars.push(...vars)
    }
  }
  if (factorDefs.length === 0 || allVars.length === 0) {
    throw new Error("请至少添加一个因子及其指标变量")
  }
  for (const f of factorDefs) {
    if (f.vars.length < 2) {
      throw new Error(`因子"${f.name}"至少需要 2 个指标变量(建议 3 个以上)`)
    }
  }

  const p = allVars.length
  const q = factorDefs.length
  const valid = data.rows.filter((r) => allVars.every((v) => isFinite(toNum(r[v]))))
  const n = valid.length
  if (n < 30) throw new Error(`样本量不足(有效样本 ${n} < 30)，无法进行验证性因子分析`)

  // Sample covariance (ML convention: denominator N)
  const rawCols: Record<string, number[]> = {}
  allVars.forEach((v) => {
    rawCols[v] = valid.map((r) => toNum(r[v]))
  })
  const mu: Record<string, number> = {}
  allVars.forEach((v) => { mu[v] = mean(rawCols[v]) })
  const S: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0
      for (let r = 0; r < n; r++) s += (rawCols[allVars[i]][r] - mu[allVars[i]]) * (rawCols[allVars[j]][r] - mu[allVars[j]])
      S[i][j] = S[j][i] = s / n
    }
  }

  // Parameter layout: free loadings, then factor Cholesky (off-diag then log-diag), then log error variances
  const varIndex: Record<string, number> = {}
  allVars.forEach((v, i) => { varIndex[v] = i })
  const loadingSlots: { row: number; col: number }[] = []
  for (let j = 0; j < q; j++) {
    for (let i = 1; i < factorDefs[j].vars.length; i++) {
      loadingSlots.push({ row: varIndex[factorDefs[j].vars[i]], col: j })
    }
  }
  const cholSlots: { r: number; c: number }[] = []
  for (let r = 0; r < q; r++) {
    for (let c = 0; c < r; c++) cholSlots.push({ r, c })
  }
  const cholDiag = q
  const nFree = loadingSlots.length + cholSlots.length + cholDiag + p

  const build = (theta: number[]): CfaModel => {
    const Lambda: number[][] = Array.from({ length: p }, () => new Array(q).fill(0))
    for (let j = 0; j < q; j++) Lambda[varIndex[factorDefs[j].vars[0]]][j] = 1
    loadingSlots.forEach((slot, idx) => { Lambda[slot.row][slot.col] = theta[idx] })
    const Lphi: number[][] = Array.from({ length: q }, () => new Array(q).fill(0))
    cholSlots.forEach((slot, idx) => { Lphi[slot.r][slot.c] = theta[loadingSlots.length + idx] })
    for (let j = 0; j < q; j++) Lphi[j][j] = Math.exp(theta[loadingSlots.length + cholSlots.length + j])
    const Phi: number[][] = Array.from({ length: q }, () => new Array(q).fill(0))
    for (let i = 0; i < q; i++) for (let j = 0; j < q; j++) {
      let s = 0
      for (let k = 0; k < q; k++) s += Lphi[i][k] * Lphi[j][k]
      Phi[i][j] = s
    }
    const Theta: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
    for (let i = 0; i < p; i++) Theta[i][i] = Math.exp(theta[loadingSlots.length + cholSlots.length + cholDiag + i])
    const Sigma: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
    for (let i = 0; i < p; i++) for (let j = i; j < p; j++) {
      let s = Theta[i][j]
      for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) s += Lambda[i][a] * Phi[a][b] * Lambda[j][b]
      Sigma[i][j] = Sigma[j][i] = s
    }
    return { Lambda, Phi, Theta, Sigma }
  }

  let logDetS = 0
  {
    const Ls = cfaChol(S)
    if (!Ls) throw new Error("协方差矩阵非正定，请检查变量")
    logDetS = cfaLogDet(Ls)
  }
  function cfaLogDet(L: number[][]): number {
    let s = 0
    for (let i = 0; i < L.length; i++) s += Math.log(L[i][i])
    return 2 * s
  }

  const discrepancy = (theta: number[]): number => {
    const { Sigma } = build(theta)
    const L = cfaChol(Sigma)
    if (!L) return 1e10
    const Sinv = cfaInvertFromChol(L)
    let tr = 0
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) tr += S[i][j] * Sinv[j][i]
    return cfaLogDet(L) + tr - logDetS - p
  }

  // Initial values from first-indicator regression + sum-score correlations
  const theta0: number[] = new Array(nFree).fill(0)
  loadingSlots.forEach((slot, idx) => {
    const v1 = factorDefs[slot.col].vars[0]
    const i = slot.row
    theta0[idx] = S[i][varIndex[v1]] / S[varIndex[v1]][varIndex[v1]]
  })
  const sumScores: number[][] = factorDefs.map((f) =>
    f.vars.map((v) => rawCols[v]).reduce((acc, col) => col.map((x, r) => x + acc[r]), new Array(n).fill(0))
  )
  const phiInit: number[][] = Array.from({ length: q }, () => new Array(q).fill(0))
  for (let j = 0; j < q; j++) {
    const v1 = factorDefs[j].vars[0]
    phiInit[j][j] = 0.9 * S[varIndex[v1]][varIndex[v1]]
  }
  for (let j = 0; j < q; j++) for (let k = 0; k < q; k++) {
    if (j === k) continue
    const mj = mean(sumScores[j]), mk = mean(sumScores[k])
    let cov = 0, vj = 0, vk = 0
    for (let r = 0; r < n; r++) {
      cov += (sumScores[j][r] - mj) * (sumScores[k][r] - mk)
      vj += (sumScores[j][r] - mj) ** 2
      vk += (sumScores[k][r] - mk) ** 2
    }
    phiInit[j][k] = (cov / n) / Math.sqrt((vj / n) * (vk / n)) * Math.sqrt(phiInit[j][j] * phiInit[k][k])
  }
  {
    const Lphi0 = cfaChol(phiInit)
    if (Lphi0) {
      cholSlots.forEach((slot, idx) => { theta0[loadingSlots.length + idx] = Lphi0[slot.r][slot.c] })
      for (let j = 0; j < q; j++) theta0[loadingSlots.length + cholSlots.length + j] = Math.log(Lphi0[j][j])
    } else {
      for (let j = 0; j < q; j++) theta0[loadingSlots.length + cholSlots.length + j] = Math.log(Math.sqrt(phiInit[j][j]))
    }
  }
  for (let i = 0; i < p; i++) {
    const owner = factorDefs.findIndex((f) => f.vars.includes(allVars[i]))
    const v1 = factorDefs[owner].vars[0]
    const lam = i === varIndex[v1] ? 1 : theta0[loadingSlots.findIndex((s) => s.row === i)]
    const resid = Math.max(S[i][i] - lam * lam * phiInit[owner][owner], 0.05 * S[i][i])
    theta0[loadingSlots.length + cholSlots.length + cholDiag + i] = Math.log(resid)
  }

  // BFGS with numerical gradient
  const gradF = (x: number[]): number[] => {
    const g = new Array(x.length).fill(0)
    for (let i = 0; i < x.length; i++) {
      const h = 1e-5 * Math.max(1, Math.abs(x[i]))
      const xp = x.slice(); xp[i] += h
      const xm = x.slice(); xm[i] -= h
      g[i] = (discrepancy(xp) - discrepancy(xm)) / (2 * h)
    }
    return g
  }
  let x = theta0.slice()
  let fx = discrepancy(x)
  let g = gradF(x)
  let H: number[][] = Array.from({ length: nFree }, (_, i) => Array.from({ length: nFree }, (_, j) => (i === j ? 1 : 0)))
  let converged = false
  for (let iter = 0; iter < 600; iter++) {
    const gnorm = Math.sqrt(g.reduce((s, v) => s + v * v, 0))
    if (gnorm < 1e-8) { converged = true; break }
    // descent direction
    const d = new Array(nFree).fill(0)
    for (let i = 0; i < nFree; i++) {
      let s = 0
      for (let j = 0; j < nFree; j++) s += H[i][j] * g[j]
      d[i] = -s
    }
    let gd = 0
    for (let i = 0; i < nFree; i++) gd += g[i] * d[i]
    if (gd > -1e-12) {
      H = Array.from({ length: nFree }, (_, i) => Array.from({ length: nFree }, (_, j) => (i === j ? 1 : 0)))
      for (let i = 0; i < nFree; i++) d[i] = -g[i]
      gd = -g.reduce((s, v) => s + v * v, 0)
    }
    // backtracking line search
    let t = 1, xn = x.slice(), fn = 1e10
    for (let ls = 0; ls < 60; ls++) {
      xn = x.map((v, i) => v + t * d[i])
      fn = discrepancy(xn)
      if (fn <= fx + 1e-4 * t * gd) break
      t *= 0.5
      if (t < 1e-14) break
    }
    if (fn >= fx - 1e-14 || !isFinite(fn)) {
      if (Math.sqrt(g.reduce((s, v) => s + v * v, 0)) < 1e-6) { converged = true }
      break
    }
    const gn = gradF(xn)
    const sVec = xn.map((v, i) => v - x[i])
    const yVec = gn.map((v, i) => v - g[i])
    let sy = 0
    for (let i = 0; i < nFree; i++) sy += sVec[i] * yVec[i]
    if (sy > 1e-12) {
      const rho = 1 / sy
      const Hy: number[] = new Array(nFree).fill(0)
      for (let i = 0; i < nFree; i++) {
        for (let j = 0; j < nFree; j++) Hy[i] += H[i][j] * yVec[j]
      }
      let yHy = 0
      for (let i = 0; i < nFree; i++) yHy += yVec[i] * Hy[i]
      for (let i = 0; i < nFree; i++) {
        for (let j = 0; j < nFree; j++) {
          H[i][j] = H[i][j] - (sVec[i] * Hy[j] + Hy[i] * sVec[j]) * rho + rho * rho * (yHy + sy) * sVec[i] * sVec[j]
        }
      }
    }
    x = xn; fx = fn; g = gn
  }
  if (!converged && Math.sqrt(g.reduce((s, v) => s + v * v, 0)) > 1e-5) {
    throw new Error("模型未能收敛，请检查因子结构是否合理(每个因子建议 3 个以上指标)")
  }

  const fit = build(x)
  const df = p * (p + 1) / 2 - nFree
  if (df <= 0) throw new Error("模型自由度不足(指标数太少或因子过多)，无法估计")

  const chisq = (n - 1) * fx
  const chisqP = 1 - cfaChiSqCDF(chisq, df)

  // Baseline (independence) model
  let logDetR = 0
  {
    const R: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) R[i][j] = S[i][j] / Math.sqrt(S[i][i] * S[j][j])
    const Lr = cfaChol(R)
    if (!Lr) throw new Error("相关矩阵非正定，请检查变量")
    let s = 0
    for (let i = 0; i < p; i++) s += Math.log(Lr[i][i])
    logDetR = 2 * s
  }
  const chisqB = (n - 1) * (-logDetR)
  const dfB = p * (p - 1) / 2

  const cfi = 1 - Math.max(chisq - df, 0) / Math.max(chisq - df, chisqB - dfB, 0)
  const tli = (chisqB / dfB - chisq / df) / (chisqB / dfB - 1)
  const rmsea = Math.sqrt(Math.max(chisq - df, 0) / (df * (n - 1)))
  let srmrAcc = 0
  for (let i = 0; i < p; i++) for (let j = i; j < p; j++) {
    const r = (S[i][j] - fit.Sigma[i][j]) / Math.sqrt(S[i][i] * S[j][j])
    srmrAcc += r * r
  }
  const srmr = Math.sqrt(srmrAcc / (p * (p + 1) / 2))

  // Observed information -> asymptotic covariance of parameters
  const acov = (() => {
    const h: number[] = x.map((v) => 1e-4 * Math.max(1, Math.abs(v)))
    const Hm: number[][] = Array.from({ length: nFree }, () => new Array(nFree).fill(0))
    for (let i = 0; i < nFree; i++) for (let j = i; j < nFree; j++) {
      const pp = x.slice(), pm = x.slice(), mp = x.slice(), mm = x.slice()
      pp[i] += h[i]; pp[j] += h[j]
      pm[i] += h[i]; pm[j] -= h[j]
      mp[i] -= h[i]; mp[j] += h[j]
      mm[i] -= h[i]; mm[j] -= h[j]
      const v = (discrepancy(pp) - discrepancy(pm) - discrepancy(mp) + discrepancy(mm)) / (4 * h[i] * h[j])
      Hm[i][j] = Hm[j][i] = v
    }
    // small ridge for stability
    for (let i = 0; i < nFree; i++) Hm[i][i] *= 1 + 1e-10
    const inv = invertMatrix(Hm)
    return inv.map((row, i) => row.map((v) => v * (2 / (n - 1))))
  })()

  // Standardized loadings with delta-method SE
  const stdLoading = (theta: number[], row: number, col: number): number => {
    const m = build(theta)
    return m.Lambda[row][col] * Math.sqrt(m.Phi[col][col]) / Math.sqrt(m.Sigma[row][row])
  }
  const tables: ResultTable[] = []

  const lamStd: Record<string, number[]> = {}
  for (let j = 0; j < q; j++) {
    const f = factorDefs[j]
    const loadHeaders = ["指标", "标准化载荷", "标准误(SE)", "CR(临界比)", "p值", "显著性"]
    const loadRows: (string | number)[][] = []
    const stds: number[] = []
    for (const v of f.vars) {
      const row = varIndex[v]
      const ls = stdLoading(x, row, j)
      // delta method: numerical gradient of std loading w.r.t. theta
      const gvec = new Array(nFree).fill(0)
      for (let k = 0; k < nFree; k++) {
        const h = 1e-5 * Math.max(1, Math.abs(x[k]))
        const xp = x.slice(); xp[k] += h
        const xm = x.slice(); xm[k] -= h
        gvec[k] = (stdLoading(xp, row, j) - stdLoading(xm, row, j)) / (2 * h)
      }
      let gv = 0
      for (let a = 0; a < nFree; a++) for (let b = 0; b < nFree; b++) gv += gvec[a] * acov[a][b] * gvec[b]
      const se = Math.sqrt(Math.max(gv, 0))
      const cr = ls / se
      const pv = 2 * (1 - normalCDF(Math.abs(cr)))
      stds.push(ls)
      loadRows.push([v, fmt(ls), fmt(se), fmt(cr), fmtP(pv), stars(pv)])
    }
    lamStd[f.name] = stds

    const k = f.vars.length
    const sumSq = stds.reduce((s, v) => s + v * v, 0)
    const sumL = stds.reduce((s, v) => s + v, 0)
    const AVE = sumSq / k
    const CR = sumL * sumL / (sumL * sumL + k - sumSq)
    // real Cronbach alpha from data
    const itemVars = f.vars.map((v) => S[varIndex[v]][varIndex[v]])
    let totalVar = 0
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) totalVar += S[varIndex[f.vars[a]]][varIndex[f.vars[b]]]
    const alpha = k / (k - 1) * (1 - itemVars.reduce((s, v) => s + v, 0) / totalVar)

    tables.push({ title: `${f.name} - 因子载荷`, type: "table", headers: loadHeaders, rows: loadRows })
    tables.push({
      title: `${f.name} - 聚合效度`,
      type: "table",
      headers: ["指标", "值", "参考标准"],
      rows: [
        ["AVE(平均方差抽取量)", fmt(AVE), ">0.5", ],
        ["CR(组合信度)", fmt(CR), ">0.7"],
        ["Cronbach's α", fmt(alpha), ">0.7"],
      ],
    })
  }

  // Factor correlations & discriminant validity
  if (q > 1) {
    const discHeaders = ["", ...factorDefs.map((f) => f.name)]
    const discRows = factorDefs.map((fj, j) => [
      fj.name,
      ...factorDefs.map((fk, k) => {
        if (j === k) return fmt(Math.sqrt(lamStd[fj.name].reduce((s, v) => s + v * v, 0) / fj.vars.length))
        return fmt(fit.Phi[j][k] / Math.sqrt(fit.Phi[j][j] * fit.Phi[k][k]))
      }),
    ])
    tables.push({
      title: "因子相关矩阵与区分效度",
      type: "table",
      headers: discHeaders,
      rows: discRows,
      footnotes: ["对角线数值为 √AVE，判别标准：对角线值应大于所在行与列的因子相关系数"],
    })
  }

  const fitRows: (string | number)[][] = [
    ["χ²(卡方)", fmt(chisq), "-", "-"],
    ["df(自由度)", String(df), "-", "-"],
    ["χ²/df", fmt(chisq / df), "<3", chisq / df < 3 ? "良好" : chisq / df < 5 ? "可接受" : "需改进"],
    ["p值(χ²)", fmtP(chisqP), ">0.05", chisqP > 0.05 ? "良好" : "严格达标较难，结合其他指标判断"],
    ["CFI", fmt(cfi), ">0.90", cfi >= 0.9 ? "良好" : "需改进"],
    ["TLI", fmt(tli), ">0.90", tli >= 0.9 ? "良好" : "需改进"],
    ["RMSEA", fmt(rmsea), "<0.08", rmsea < 0.08 ? "可接受" : "需改进"],
    ["SRMR", fmt(srmr), "<0.08", srmr < 0.08 ? "良好" : "需改进"],
    ["有效样本量", String(n), "-", "-"],
  ]
  tables.push({
    title: "模型拟合指数(极大似然估计)",
    type: "table",
    headers: ["指标", "值", "参考标准", "评价"],
    rows: fitRows,
    footnotes: ["估计方法：极大似然(ML)；每个因子的首个指标载荷固定为1以识别模型"],
  })

  return {
    methodId: "cfa",
    methodName: "验证性因子分析",
    timestamp: Date.now(),
    tables,
  }
}

// ============================================================
// SEM (AMOS text input mode)
// ============================================================

export function performSEM(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const semText = variables["semPathText"] || variables["semText"] || ""
  if (!semText && typeof semText !== "string") throw new Error("请粘贴AMOS输出结果")

  // Parse AMOS text output
  const text = String(semText)
  const tables: ResultTable[] = []

  // Try to extract model fit
  const fitMatch = text.match(/CMIN[=\s]*([\d.]+)/i)
  const dfMatch = text.match(/DF[=\s]*(\d+)/i)
  const cfiMatch = text.match(/CFI[=\s]*([\d.]+)/i)
  const rmseaMatch = text.match(/RMSEA[=\s]*([\d.]+)/i)

  if (fitMatch || text.length > 50) {
    tables.push({
      title: "AMOS分析结果",
      type: "table",
      headers: ["指标", "值"],
      rows: [
        ["输入文本长度", String(text.length) + " 字符"],
        ["χ²/df", fitMatch && dfMatch ? fmt(parseFloat(fitMatch[1]) / parseInt(dfMatch[1]), 2) : "未识别"],
        ["CFI", cfiMatch ? cfiMatch[1] : "未识别"],
        ["RMSEA", rmseaMatch ? rmseaMatch[1] : "未识别"],
      ],
    })
  }

  // Raw text output
  tables.push({
    title: "原始输出",
    type: "text",
    headers: [],
    rows: [[text.substring(0, 5000)]],
  })

  return {
    methodId: "sem",
    methodName: "结构方程模型(SEM)",
    timestamp: Date.now(),
    tables,
  }
}

// ============================================================
// Path Analysis
// ============================================================

export function performPathAnalysis(data: DataTable, variables: AnalysisVariables): AnalysisResult {
  const vars = variables["variables"] || []
  if (vars.length < 3) throw new Error("请至少选择3个变量进行路径分析")

  const valid = data.rows.filter((r) => vars.every((v) => isFinite(toNum(r[v]))))
  const n = valid.length

  // For demonstration, compute all pairwise regressions
  const tables: ResultTable[] = []
  const pathHeaders = ["路径", "标准化系数(β)", "非标准化系数(B)", "标准误(SE)", "t值", "p值", "显著性"]

  // Treat last var as ultimate outcome, others in sequence
  const y = vars[vars.length - 1]
  const xs = vars.slice(0, -1)

  const pathRows: (string | number)[][] = []
  for (const x of xs) {
    const reg = simpleReg(valid, x, y)
    // Standardize
    const xVals = valid.map((r) => toNum(r[x]))
    const yVals = valid.map((r) => toNum(r[y]))
    const sx = std(xVals), sy = std(yVals)
    const stdBeta = sx > 0 && sy > 0 ? reg.beta * sx / sy : NaN

    pathRows.push([`${x} → ${y}`, fmt(stdBeta), fmt(reg.beta), fmt(reg.se), fmt(reg.t), fmtP(reg.p), stars(reg.p)])
  }

  // Also compute among X variables
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const reg = simpleReg(valid, xs[i], xs[j])
      const xVals = valid.map((r) => toNum(r[xs[i]]))
      const yVals = valid.map((r) => toNum(r[xs[j]]))
      const sx = std(xVals), sy = std(yVals)
      const stdBeta = sx > 0 && sy > 0 ? reg.beta * sx / sy : NaN
      pathRows.push([`${xs[i]} → ${xs[j]}`, fmt(stdBeta), fmt(reg.beta), fmt(reg.se), fmt(reg.t), fmtP(reg.p), stars(reg.p)])
    }
  }

  tables.push({ title: "路径系数", type: "table", headers: pathHeaders, rows: pathRows })

  return {
    methodId: "path-analysis",
    methodName: "路径分析",
    timestamp: Date.now(),
    tables,
  }
}

// ============================================================
// Dispatch
// ============================================================

export type AnalysisMethod = 
  | "descriptive" | "frequency" | "correlation" | "reliability" | "validity"
  | "chi-square" | "linear-regression" | "anova" | "ttest-independent" | "ttest-paired"
  | "cfa" | "efa" | "sem" | "moderation" | "mediation"
  | "ipa" | "cluster" | "binary-logit" | "partial-correlation" | "path-analysis"

const dispatch: Record<AnalysisMethod, (data: DataTable, vars: AnalysisVariables) => AnalysisResult> = {
  "descriptive": performDescriptive,
  "frequency": performFrequency,
  "correlation": performCorrelation,
  "reliability": performReliability,
  "validity": performValidity,
  "chi-square": performChiSquare,
  "linear-regression": performLinearRegression,
  "anova": performANOVA,
  "ttest-independent": performIndependentTTest,
  "ttest-paired": performPairedTTest,
  "cfa": performCFA,
  "efa": performEFA,
  "sem": performSEM,
  "moderation": performModeration,
  "mediation": performMediation,
  "ipa": performIPA,
  "cluster": performCluster,
  "binary-logit": performBinaryLogit,
  "partial-correlation": performPartialCorrelation,
  "path-analysis": performPathAnalysis,
}

export function runAnalysis(
  methodId: AnalysisMethod,
  data: DataTable,
  variables: AnalysisVariables
): AnalysisResult {
  const fn = dispatch[methodId]
  if (!fn) throw new Error(`未知分析方法: ${methodId}`)
  return fn(data, variables)
}
