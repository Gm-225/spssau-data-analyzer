# AMOS Bridge V1 验证记录（2026-07-17）

关联：Issue 010 / T-20260717-14

## 结论

固定 PP/AA/PC/PI/PV 问卷方案已经可以从 Electron 的自然语言请求后台调用用户本机 IBM SPSS Amos Engine，并生成 JSON、Amos 原始输出、模型图、DOCX 与 PDF。发布包不携带 IBM 二进制，真实 NSIS 安装态离线 E2E 通过。

## 本机引擎与发布物

- Amos home：`D:\工作\spss`
- `Amos.EngineLib.dll`：版本 `2.2.7804.21429`；SHA-256 `347C2A654FFC6A638AE85D7F85D0F4815DF47C1CCF316B5119233A304C476EDB`
- Setup：`release-amos-v1/AI-Data-Analyzer-2.0.1-x64-Setup.exe`；184127380 bytes；SHA-256 `B2A067CB75F6AEBF9A72C71A24CCE00B523C96AC0820F4BD27A1FAE3B1C85012`
- Portable：`release-amos-v1/AI-Data-Analyzer-2.0.1-x64-Portable.exe`；183790959 bytes；SHA-256 `746D9C7189C8A64C6B83476F6A142D0E74477975E5570306EEBCB7FD3477C320`
- 发布 Bridge：40960 bytes；SHA-256 `E9C71E495B64C8D354795EDD09B09FDF64B65B94408D1280D2E44ACAEDCC4E67`
- 打包资源内 `Amos.EngineLib.dll`、`Amos.dll`、`AmosGraphicsCLI.exe` 命中数：0。

## 可重放证据

- `npm run test:amos`
- 自动化：`data/validation/T-20260717-14-amos/automated-20260717-231518/verification-summary.json`
- 正式 5000 次报告：`data/validation/T-20260717-14-amos/final-5000-20260717-231558`
- 真实安装态：`D:\Temp\AIAnalyzerAmosE2E-20260717-2324/e2e-summary.json`

自动化覆盖同 seed 复现、数据扰动敏感性、只做 AMOS 的范围限制、缺列、无效 Amos home、N=50 和历史 outputs 哈希。真实安装态从 `D:\Temp\AIAnalyzerAmosInstalled-20260717-2323/AI数据分析器.exe` 启动，应用 EXE SHA-256 `1B403E6377E7997FE856D79891DDE7410786AD74944EBCA3F6CCFC2429323515`；冷启动 15.559 秒、首次完整分析 20.313 秒、重复分析 9.545 秒，5000/5000 Bootstrap，固定种子 AMOS 指纹一致，外部网络请求 0，无效需求报告产物 0，历史 outputs 逐字节一致。

## 科学结果与视觉

- N=160；χ²(163)=200.797，p=.023；CMIN/df=1.232；CFI=.986；TLI=.984；RMSEA=.038。
- GFI=.890、AGFI=.858 未达 .900；不能写“全部拟合指标良好”。RMR=.076 为非标准化 RMR，不是 SRMR。
- PP→AA：B=.2368，β=.2442，p=.007；关键载荷、AVE/CR、R²、直接/间接/总效应均进入结构化输出和报告。
- 最终 DOCX 12 页，SHA-256 `5F2EB683DE9FA76020D95715E89AD600AD38D504A95623A1A8454119674A3D7F`；PDF 11 页，SHA-256 `DAF62E7C4638425A414FBE942D66CEC68956303AA3D209054DDBCBE87112F6AA`。中文、三线表、模型图和调节图视觉抽查通过。

## 边界

- 只支持当前固定模型，不是任意 Amos 模型生成器。
- Likert 题项按近似连续变量使用普通 ML；PV 调节是观测合成分数 OLS，不是潜变量交互。
- 未完成 Amos GUI 逐字段并排证据，以及 Heywood、不收敛和非正定协方差矩阵的专项错误态。
- 安装包未代码签名；目标电脑必须自行合法安装并配置 Amos。
