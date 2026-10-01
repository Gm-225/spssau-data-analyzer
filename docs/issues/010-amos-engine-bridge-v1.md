# Issue 010 - AMOS Engine 一键分析桥接 V1

type: feature
status: verify
main_flow: yes
user_pain: 当前每个订单仍要手工打开 AMOS、画模型、勾选输出、复制拟合度和路径结果，阻断一键交付；现有工具中的 CFA/SEM 又不是真实 SEM 计算，不能替代。
owner: Codex / T-20260717-14

## 产品任务

用户在 AI 数据分析器中上传题项级 Excel/CSV，用自然语言说明潜变量、测量题项和结构路径，确认系统识别的模型后点击一次分析。应用在后台调用本机已授权的 IBM SPSS Amos Engine，无需打开 AMOS 图形界面，并把真实 AMOS 数值、路径图、三线表和解释直接写入现有 DOCX/PDF 报告。

## 当前事实

- 旧的前端 `performCFA()` / `performSEM()` 不再承担 AMOS 请求；包含 AMOS、SEM、CFA、结构方程或验证性因子的指令会进入科学 pipeline，并调用本地 Bridge。
- V1 是固定问卷方案，不是任意模型生成器：PP4、AA3、PC4、PI5、PV4；结构为 PP→PC/PI/AA、PC/PI/PV→AA、PP↔PV。
- 用户电脑已安装 IBM SPSS Amos 28，安装目录 `D:\工作\spss` 内存在 `Amos.EngineLib.dll`、`AmosGraphicsCLI.exe`、编程文档和官方示例。
- Amos 官方编程接口支持 `AmosEngine`、`BeginGroup`、`AStructure`、`FitModel`、`Standardized`、`TextOutput` 与 `Bootstrap`，可在不操作图形界面的情况下使用同一估计引擎。
- IBM 官方将 Amos 定义为包含 SEM、路径分析、CFA、Bayesian、类别/删失数据和潜类分析的软件；V1 不复制全部产品面。

## 推荐架构

### 精确模式：AMOS Bridge（本 Issue）

- 新建受控的本地 .NET sidecar，只动态引用用户电脑上已安装、已授权的 Amos Engine。
- 应用传入结构化模型 JSON；sidecar 生成 AMOS 模型、调用同一估计引擎并返回结构化 JSON。
- 不复制、不打包、不再分发 IBM DLL 或许可证；AMOS 缺失/未授权时明确阻断。
- 这是当前用户实现“结果与 AMOS 一致、但不用手工打开 AMOS”的最短路径。

### 独立模式：Open SEM Engine（后续 Issue）

- 后续可接 semopy 或 lavaan，为未安装 AMOS 的电脑提供独立 SEM。
- 参数通常可非常接近，但估计器、缺失值、基线模型、标准化和 Bootstrap 实现不同，不能承诺与 AMOS 每个小数位完全一致。
- 该模式必须明确标注引擎来源，不得冒充 AMOS 输出。

## V1 支持范围

- 连续/近似连续题项的最大似然估计（ML）。
- 多因子 CFA：潜变量、测量题项、载荷、误差项、因子相关。
- 潜变量结构路径：直接效应、并行中介、总效应；5000 次 Bootstrap 置信区间。
- 标准化和非标准化估计、SE、C.R./z、p、R²、方差/协方差。
- 模板要求的拟合度：CMIN、df、p、CMIN/df、GFI、AGFI、RMSEA、NFI、IFI、CFI、RFI、PGFI；同时保留 TLI/SRMR/AIC/BIC 等可审计指标。
- 自动模型图：潜变量椭圆、观测变量矩形、误差项、单向/双向路径和标准化系数。
- 输出沿用现有 A4 DOCX/PDF：模型图、拟合度表、路径检验表、中介效应表和逐表解释。

## V1 不包含

- Bayesian SEM、潜类/混合模型、增长模型、多层 SEM。
- 多组测量不变性、类别/删失变量估计、复杂抽样。
- 根据修正指数自动放开路径；只能列建议，必须由用户确认，避免数据驱动篡改模型。
- 在安装包中捆绑或向无许可证用户分发 IBM Amos 组件。

## 验收门槛

- [x] 功能：synthetic 题项数据 → 自然语言固定方案 → 后台 AMOS Engine → JSON/DOCX/PDF，全程不依赖 AMOS GUI 操作。
- [x] 数值：API 字段与同次 Amos 原始 XHTML 可追溯；改变 AA 数据后关键路径和 CMIN 随之变化，固定输入与种子连续两次完全复现。
- [x] Bootstrap：正式基准完成 5000/5000 次有效抽样，输出直接、PC/PI 特定间接、总间接和总效应的区间及有限样本经验 p 值。
- [x] 模板：覆盖模型图、拟合度、测量模型、结构路径、中介效应和逐表解释；DOCX 12 页、PDF 11 页视觉通过。
- [x] 错误态：缺列、无效 Amos 目录、N=50 样本不足和无效自然语言需求均明确拒绝，报告产物为 0。
- [x] 安全：只调用本机已授权安装，不复制 IBM 二进制；输入和输出写入隔离任务目录。
- [x] 回归：现有 PP/AA/PC/PI/PV 主线、真实 NSIS 安装态 E2E、科学基准和历史 `outputs` 完整性不回退。
- [ ] 扩展验收：另补 Amos GUI 逐字段并排对照，以及 Heywood、不收敛、非正定协方差矩阵的专门错误态。

## 基准数据要求

- 使用 Amos 安装自带的公开示例做接口烟测。
- 新建明确标注 synthetic 的问卷模型，保存原始数据、模型 JSON、AMOS GUI 输出、Bridge 输出和逐字段差异。
- 在真正停止人工 AMOS 前，至少用 3 个不同结构的订单级模型做一次双跑：多因子 CFA、普通 SEM、并行中介 SEM。

## 单命令目标

```powershell
npm run test:amos
```

命令必须生成字段级差异 JSON、报告渲染和错误态证据；任何固定演示值、文本解析替代估计或无声降级都必须失败。

## 已知边界

- “后台调用同一 AMOS Engine”可以追求展示精度一致，但仍依赖用户本机的 Amos 版本和许可证。
- “完全不安装 AMOS”只能使用独立引擎，结论可以统计等价，不能承诺与商业软件逐字节相同。

## 2026-07-17 实现与验证结论

- 用户完成官方 Amos 配置后，Bridge 已成功调用 `D:\工作\spss\Amos.EngineLib.dll`；DLL 版本 `2.2.7804.21429`，SHA-256 `347C2A654FFC6A638AE85D7F85D0F4815DF47C1CCF316B5119233A304C476EDB`。
- 配置只保存本机目录到 `%LOCALAPPDATA%\AI-Data-Analyzer\amos-engine.json`。发布包只包含自研 Bridge，扫描到 IBM 二进制数量为 0。
- synthetic N=160 基准：χ²(163)=200.797，p=.023，CMIN/df=1.232，CFI=.986，TLI=.984，RMSEA=.038；GFI=.890、AGFI=.858 未达 .900，不能表述为“全部拟合指标良好”。RMR=.076 是非标准化 RMR，不是 SRMR。
- 5000 次 Bootstrap、报告生成、敏感性、固定种子复现和三类输入错误态通过；自动化证据在 `data/validation/T-20260717-14-amos/automated-20260717-231518`。
- 最终源侧报告在 `data/validation/T-20260717-14-amos/final-5000-20260717-231558`；DOCX SHA-256 `5F2EB683DE9FA76020D95715E89AD600AD38D504A95623A1A8454119674A3D7F`，PDF SHA-256 `DAF62E7C4638425A414FBE942D66CEC68956303AA3D209054DDBCBE87112F6AA`。
- 真实 NSIS 安装态 E2E 在 `D:\Temp\AIAnalyzerAmosE2E-20260717-2324`：5000/5000、固定种子复现、外联 0、无效需求伪报告 0、历史 `outputs` 逐字节一致。
- 发布包 Bridge SHA-256 为 `E9C71E495B64C8D354795EDD09B09FDF64B65B94408D1280D2E44ACAEDCC4E67`。C# 编译产物含构建时间信息，证据运行的临时重编译哈希不作为发布包哈希。

## 科学与产品边界

- Likert 题项按近似连续变量使用普通 ML；尚未实现类别变量估计、稳健标准误或 WLSMV。
- PV 调节仍由观测合成分数 OLS 完成，不是 Amos 潜变量交互模型。
- V1 不包含 HTMT、任意模型拖拽/语法生成、高级 SEM 或自动按修正指数改模型。
- 当前已替代本固定方案的日常手工 Amos 步骤，但不能宣称替代 Amos 的全部能力；GUI 逐字段对照和更多模型族留作扩展验收。
- 使用者必须拥有可用的本机 Amos 安装与许可；Setup/Portable 当前未做代码签名。
