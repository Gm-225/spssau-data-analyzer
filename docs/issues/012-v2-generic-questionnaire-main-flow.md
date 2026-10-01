# Issue 012 - V2 通用问卷基础分析主线

type: feature
status: done
main_flow: yes
user_pain: 当前可信科学报告绑定 PP/AA/PC/PI/PV 固定问卷，换一套变量后无法复用。
owner: Codex / T-20260720-03

## Request

上传任意使用连续题项前缀的 Excel/CSV，在自然语言中说明维度名称和自变量/因变量，系统生成可审计分析方案并输出基础信息、缺失、频数、描述统计、信度、EFA、相关、多元回归及动态论文文字的 Word/PDF。

## Acceptance Criteria

- [x] 非 PP/AA/PC/PI/PV 的三维样例可完成科学分析和 DOCX/PDF。
- [x] 自然语言可识别 `SAT=满意度`、多个自变量与一个因变量。
- [x] 每次 Electron 任务保存独立 `analysis-plan.json`，统计内核校验方案和维度引用。
- [x] 数据基本信息和逐变量缺失值表符合 V2 模板。
- [x] 多元回归输出 R²、调整 R²、F、B、标准化 β、t、p、VIF。
- [x] 动态文字依据实际阈值、显著性和系数生成，不套用固定“假设成立”结论。
- [x] 旧固定高级模型、API、构建和 Electron E2E 不回退。

## Verification Evidence

- Command/check: `npm run test:v2`
- Expected: 180 行 synthetic SAT/VAL/LOY 样例生成 JSON/DOCX/PDF，完整模块与动态文字存在。
- Observed: passed；R²=0.5573698825；DOCX 42084 bytes；PDF 77518 bytes；最终 PDF 4 页。
- Command/check: `npm run test:scientific`
- Observed: passed；固定 PP/AA/PC/PI/PV α、KMO、OLS、Bootstrap 与文档验证通过，历史 outputs 哈希不变。
- Command/check: `npm run test:api`
- Observed: passed，8/8。
- Command/check: `npm run build`
- Observed: passed，1788 modules transformed。
- Command/check: `npm run test:e2e`
- Observed: passed；完整固定模型、限定信度、通用 `PP+PV → AA` 回归及无效需求四条路径、桌面布局、DOCX/PDF、零控制台错误。
- Command/check: bundled `render_docx.py` + Poppler `pdftoppm`
- Observed: passed；DOCX 6 页、PDF 4 页逐页 100% 复核，无裁切、重叠、缺字或表格溢出；移除相关与回归之间多余硬分页。

## Notes

- 通用主线当前覆盖基础统计和多元回归；任意模型的中介/调节、CFA/SEM 与 SmartPLS 分别进入后续 Issue。
- 方案中的第三方高级分析请求仍受固定契约校验，失败时不生成伪报告。
