# Issue 005 - AI 一键分析与模板化综合报告

type: feature
status: done
main_flow: yes
owner: main

## 用户痛点

现有桌面端仍依赖人工选择方法和变量，长题目发生碰撞，导出结果也不是用户提供的章节化三线表模板。

## 验收标准

- [x] 分析页有自然语言需求框和单个“一键分析”按钮。
- [x] 自动按题项前缀识别维度，并区分人口学变量。
- [x] 自动计算维度均值并分配到相关、回归分析。
- [x] 综合报告包含编号章节、三线表和表后解读。
- [x] Python 生成真实 DOCX/PDF，使用 A4、宋体/黑体、编号标题、三线表、表后解读和模型图。
- [x] 长标题截断、换行并提供悬停完整内容，不再挤压类型标签。
- [x] EFA 特征分解初始化改为确定性，重复运行可复现。
- [x] TypeScript/Vite 生产构建通过。

## 验证

- 命令：`npm run build`、`npm run test:e2e`
- 结果：通过。真实 Electron 上传 100×26 Excel、一键分析、结果页、DOCX/PDF 产物完整；渲染进程控制台零错误。
- UI 证据：`data/validation/ui-e2e/01-upload.png`、`02-analysis-plan.png`、`03-results-top.png`、`04-results-full.png`。
