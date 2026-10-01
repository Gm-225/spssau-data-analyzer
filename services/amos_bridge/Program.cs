using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Xml;

namespace AnalyzerAmosBridge
{
    internal sealed class Options
    {
        public string AmosHome;
        public string Input;
        public string Sheet = "data";
        public string Output;
        public string RawOutput;
        public int Bootstrap = 0;
        public int Seed = 20260717;
    }

    internal sealed class ParameterDefinition
    {
        public string Kind;
        public string Target;
        public string Source;
        public string Label;
        public bool Fixed;
        public string Dimension;
    }

    internal sealed class RegressionStatistic
    {
        public double StandardError;
        public double CriticalRatio;
        public double Probability;
    }

    internal static class Program
    {
        private const string ErrorPrefix = "AmosBridgeError: ";

        [STAThread]
        private static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            try
            {
                Options options = ParseOptions(args);
                Dictionary<string, object> result = Run(options);
                string json = Serialize(result);
                Directory.CreateDirectory(Path.GetDirectoryName(options.Output));
                File.WriteAllText(options.Output, json, new UTF8Encoding(false));
                Console.WriteLine(json);
                return 0;
            }
            catch (Exception error)
            {
                Exception root = Unwrap(error);
                Console.Error.WriteLine(ErrorPrefix + SanitizeError(root.Message));
                return 2;
            }
        }

        private static Options ParseOptions(string[] args)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; index < args.Length; index++)
            {
                string name = args[index];
                if (!name.StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length)
                    throw new ArgumentException("参数格式无效。需要 --amos-home、--input、--sheet、--output。\n");
                values[name.Substring(2)] = args[++index];
            }

            Options options = new Options();
            options.AmosHome = Required(values, "amos-home");
            options.Input = Path.GetFullPath(Required(values, "input"));
            options.Output = Path.GetFullPath(Required(values, "output"));
            string value;
            if (values.TryGetValue("sheet", out value) && !String.IsNullOrWhiteSpace(value)) options.Sheet = value;
            if (values.TryGetValue("raw-output", out value) && !String.IsNullOrWhiteSpace(value)) options.RawOutput = Path.GetFullPath(value);
            if (values.TryGetValue("bootstrap", out value) && !Int32.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out options.Bootstrap))
                throw new ArgumentException("--bootstrap 必须是整数。");
            if (values.TryGetValue("seed", out value) && !Int32.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out options.Seed))
                throw new ArgumentException("--seed 必须是整数。");
            if (options.Bootstrap < 0 || options.Bootstrap > 20000)
                throw new ArgumentException("--bootstrap 必须在 0 到 20000 之间。");
            if (!File.Exists(options.Input)) throw new FileNotFoundException("AMOS 输入文件不存在。", options.Input);
            if (!String.Equals(Path.GetExtension(options.Input), ".xlsx", StringComparison.OrdinalIgnoreCase) &&
                !String.Equals(Path.GetExtension(options.Input), ".xls", StringComparison.OrdinalIgnoreCase) &&
                !String.Equals(Path.GetExtension(options.Input), ".sav", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("AMOS Bridge 当前仅接受 xlsx、xls 或 sav 输入。");
            options.AmosHome = Path.GetFullPath(options.AmosHome);
            return options;
        }

        private static string Required(Dictionary<string, string> values, string name)
        {
            string value;
            if (!values.TryGetValue(name, out value) || String.IsNullOrWhiteSpace(value))
                throw new ArgumentException("缺少 --" + name + " 参数。");
            return value.Trim();
        }

        private static Dictionary<string, object> Run(Options options)
        {
            string engineDll = Path.Combine(options.AmosHome, "Amos.EngineLib.dll");
            if (!File.Exists(engineDll))
                throw new FileNotFoundException("所选目录不是有效的 Amos 安装目录：缺少 Amos.EngineLib.dll。", engineDll);

            string previousDirectory = Environment.CurrentDirectory;
            string previousPath = Environment.GetEnvironmentVariable("PATH") ?? String.Empty;
            string previousTemp = Environment.GetEnvironmentVariable("TEMP");
            string previousTmp = Environment.GetEnvironmentVariable("TMP");
            string isolatedTemp = Path.Combine(
                Path.GetDirectoryName(options.Output),
                ".amos-temp-" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N")
            );
            Mutex mutex = new Mutex(false, "Global\\AIDataAnalyzer-AmosEngine-Bridge-V1");
            bool ownsMutex = false;
            Stopwatch stopwatch = Stopwatch.StartNew();
            try
            {
                try { ownsMutex = mutex.WaitOne(TimeSpan.FromMinutes(15)); }
                catch (AbandonedMutexException) { ownsMutex = true; }
                if (!ownsMutex) throw new TimeoutException("等待本机 Amos Engine 超时，请关闭其他正在运行的 Amos 分析后重试。");

                Environment.CurrentDirectory = options.AmosHome;
                Environment.SetEnvironmentVariable("PATH", options.AmosHome + Path.PathSeparator + previousPath);
                Directory.CreateDirectory(isolatedTemp);
                Environment.SetEnvironmentVariable("TEMP", isolatedTemp);
                Environment.SetEnvironmentVariable("TMP", isolatedTemp);
                AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs eventArgs)
                {
                    string file = Path.Combine(options.AmosHome, new AssemblyName(eventArgs.Name).Name + ".dll");
                    return File.Exists(file) ? Assembly.LoadFrom(file) : null;
                };

                Assembly assembly = Assembly.LoadFrom(engineDll);
                Type engineType = assembly.GetType("AmosEngineLib.AmosEngine", true);
                Type matrixType = engineType.GetNestedType("TMatrixID", BindingFlags.Public);
                object direct = Enum.Parse(matrixType, "DirectEffects");
                object indirect = Enum.Parse(matrixType, "IndirectEffects");
                object total = Enum.Parse(matrixType, "TotalEffects");
                object standardizedDirect = Enum.Parse(matrixType, "StandardizedDirectEffects");
                object standardizedIndirect = Enum.Parse(matrixType, "StandardizedIndirectEffects");
                object standardizedTotal = Enum.Parse(matrixType, "StandardizedTotalEffects");

                dynamic sem = Activator.CreateInstance(engineType);
                try
                {
                    sem.EnableDisplay(false);
                    sem.HideShutdownErrors(true);
                    sem.TextOutput();
                    sem.Standardized();
                    sem.Smc();
                    sem.TotalEffects();
                    sem.NeedEstimates((dynamic)direct);
                    sem.NeedEstimates((dynamic)indirect);
                    sem.NeedEstimates((dynamic)total);
                    sem.NeedEstimates((dynamic)standardizedDirect);
                    sem.NeedEstimates((dynamic)standardizedIndirect);
                    sem.NeedEstimates((dynamic)standardizedTotal);
                    int amosSeed = ((options.Seed % 29999) + 29999) % 29999 + 1;
                    if (options.Bootstrap > 0)
                    {
                        sem.Seed(amosSeed);
                        sem.NeedBootSampleEstimates((dynamic)direct);
                        sem.Bootstrap(options.Bootstrap);
                        sem.ConfidenceBC(95.0);
                    }

                    sem.BeginGroup(options.Input, options.Sheet);
                    List<string> syntax;
                    List<ParameterDefinition> parameters;
                    DefineFixedQuestionnaireModel(sem, out syntax, out parameters);

                    int returnCode = sem.FitModel();
                    if (returnCode != 0) throw new InvalidOperationException("Amos Engine 拟合失败，返回码 " + returnCode + "。");
                    if (!sem.Stable()) throw new InvalidOperationException("Amos 模型未稳定收敛，未生成报告。");
                    if (!sem.Admissible()) throw new InvalidOperationException("Amos 返回不可接受解（可能存在负方差或其他 Heywood case），未生成报告。");

                    string amosOutput = sem.TextOutputFileName();
                    if (String.IsNullOrWhiteSpace(amosOutput))
                        throw new InvalidOperationException("Amos 原始输出文件未生成。");
                    amosOutput = Path.GetFullPath(amosOutput);
                    string isolatedPrefix = Path.GetFullPath(isolatedTemp).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                    if (!amosOutput.StartsWith(isolatedPrefix, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Amos 临时输出未进入隔离目录，已拒绝读取可能陈旧的共享输出。");
                    int sampleSize = (int)sem.DataFileNCases();
                    int observedVariables = (int)sem.NObservedVariablesInModel();
                    List<Dictionary<string, object>> parameterRows = BuildParameterRows(sem, parameters, standardizedDirect);
                    List<Dictionary<string, object>> validity = BuildValidity(parameterRows);
                    Dictionary<string, object> effects = BuildEffects(sem, direct, indirect, total, standardizedDirect, standardizedIndirect, standardizedTotal, options.Bootstrap, parameters);

                    // Amos finalizes the XHTML text output during disposal.  All
                    // API estimates must therefore be captured first; only then
                    // do we close the engine and parse the isolated output file.
                    sem.Shutdown();
                    sem.Dispose();
                    sem = null;
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                    WaitForStableFile(amosOutput, TimeSpan.FromSeconds(30));
                    string rawOutput = options.RawOutput ?? Path.ChangeExtension(options.Output, ".AmosOutput.html");
                    Directory.CreateDirectory(Path.GetDirectoryName(rawOutput));
                    File.Copy(amosOutput, rawOutput, true);

                    XmlDocument document = new XmlDocument();
                    document.XmlResolver = null;
                    document.Load(rawOutput);
                    Dictionary<string, object> fit = ParseFitIndices(document);
                    Dictionary<string, double> rSquared = ParseSquaredMultipleCorrelations(document);
                    ApplyRegressionStatistics(parameterRows, document);

                    stopwatch.Stop();
                    Dictionary<string, object> result = new Dictionary<string, object>();
                    result["schemaVersion"] = 1;
                    result["engine"] = new Dictionary<string, object>
                    {
                        { "name", "IBM SPSS Amos Engine" },
                        { "assemblyVersion", assembly.GetName().Version.ToString() },
                        { "fileVersion", FileVersionInfo.GetVersionInfo(engineDll).FileVersion },
                        { "engineDllSha256", Sha256(engineDll) },
                        { "amosHome", options.AmosHome },
                        { "redistributedByAnalyzer", false }
                    };
                    result["status"] = new Dictionary<string, object>
                    {
                        { "returnCode", returnCode },
                        { "stable", true },
                        { "admissible", true },
                        { "sampleSize", sampleSize },
                        { "observedVariables", observedVariables },
                        { "durationMs", stopwatch.ElapsedMilliseconds }
                    };
                    result["estimator"] = "Maximum Likelihood (Amos ML)";
                    result["inputSha256"] = Sha256(options.Input);
                    result["modelSyntax"] = syntax;
                    result["fit"] = fit;
                    result["parameters"] = parameterRows;
                    result["validity"] = validity;
                    result["rSquared"] = rSquared;
                    result["effects"] = effects;
                    result["bootstrap"] = new Dictionary<string, object>
                    {
                        { "samplesRequested", options.Bootstrap },
                        { "requestedSeed", options.Seed },
                        { "amosSeed", amosSeed },
                        { "interval", options.Bootstrap > 0 ? "bias-corrected percentile from Amos bootstrap samples" : "not requested" },
                        { "confidenceLevel", 0.95 }
                    };
                    result["rawOutput"] = rawOutput;
                    return result;
                }
                finally
                {
                    if (sem != null) sem.Dispose();
                }
            }
            finally
            {
                Environment.CurrentDirectory = previousDirectory;
                Environment.SetEnvironmentVariable("PATH", previousPath);
                Environment.SetEnvironmentVariable("TEMP", previousTemp);
                Environment.SetEnvironmentVariable("TMP", previousTmp);
                TryDeleteDirectory(isolatedTemp);
                if (ownsMutex) mutex.ReleaseMutex();
                mutex.Dispose();
            }
        }

        private static void WaitForStableFile(string path, TimeSpan timeout)
        {
            Stopwatch watch = Stopwatch.StartNew();
            long previousLength = -1;
            int stableChecks = 0;
            while (watch.Elapsed < timeout)
            {
                try
                {
                    FileInfo info = new FileInfo(path);
                    if (info.Exists && info.Length > 0)
                    {
                        bool oldEnough = DateTime.UtcNow - info.LastWriteTimeUtc >= TimeSpan.FromMilliseconds(500);
                        if (info.Length == previousLength && oldEnough) stableChecks++;
                        else stableChecks = 0;
                        previousLength = info.Length;
                        if (stableChecks >= 2)
                        {
                            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                            {
                                if (stream.Length > 0) return;
                            }
                        }
                    }
                }
                catch (IOException)
                {
                    stableChecks = 0;
                }
                Thread.Sleep(200);
            }
            throw new TimeoutException("等待 Amos 原始输出写入完成超时。");
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path)) Directory.Delete(path, true);
            }
            catch
            {
                // This is a per-run temporary directory.  Failure to remove it
                // must not mask a completed scientific result.
            }
        }

        private static void DefineFixedQuestionnaireModel(dynamic sem, out List<string> syntax, out List<ParameterDefinition> parameters)
        {
            syntax = new List<string>();
            parameters = new List<ParameterDefinition>();
            Dictionary<string, int> dimensions = new Dictionary<string, int>
            {
                { "PP", 4 }, { "AA", 3 }, { "PC", 4 }, { "PI", 5 }, { "PV", 4 }
            };
            foreach (KeyValuePair<string, int> dimension in dimensions)
            {
                for (int index = 1; index <= dimension.Value; index++)
                {
                    string item = dimension.Key + index.ToString(CultureInfo.InvariantCulture);
                    bool fixedLoading = index == 1;
                    string label = fixedLoading ? null : "l" + item;
                    string coefficient = fixedLoading ? "(1)" : "(" + label + ")";
                    string statement = item + " = " + coefficient + " " + dimension.Key + " + (1) e" + item;
                    sem.AStructure(statement);
                    syntax.Add(statement);
                    parameters.Add(new ParameterDefinition
                    {
                        Kind = "loading", Target = item, Source = dimension.Key, Label = label,
                        Fixed = fixedLoading, Dimension = dimension.Key
                    });
                }
            }

            AddPath(sem, syntax, parameters, "PC", "PP", "aPC");
            AddPath(sem, syntax, parameters, "PI", "PP", "aPI");
            string outcome = "AA = (cPrime) PP + (bPC) PC + (bPI) PI + (bPV) PV + (1) dAA";
            sem.AStructure(outcome);
            syntax.Add(outcome);
            parameters.Add(new ParameterDefinition { Kind = "structural", Target = "AA", Source = "PP", Label = "cPrime" });
            parameters.Add(new ParameterDefinition { Kind = "structural", Target = "AA", Source = "PC", Label = "bPC" });
            parameters.Add(new ParameterDefinition { Kind = "structural", Target = "AA", Source = "PI", Label = "bPI" });
            parameters.Add(new ParameterDefinition { Kind = "structural", Target = "AA", Source = "PV", Label = "bPV" });
            string covariance = "PP <--> PV (covPPPV)";
            sem.AStructure(covariance);
            syntax.Add(covariance);
        }

        private static void AddPath(dynamic sem, List<string> syntax, List<ParameterDefinition> parameters, string target, string source, string label)
        {
            string statement = target + " = (" + label + ") " + source + " + (1) d" + target;
            sem.AStructure(statement);
            syntax.Add(statement);
            parameters.Add(new ParameterDefinition { Kind = "structural", Target = target, Source = source, Label = label });
        }

        private static List<Dictionary<string, object>> BuildParameterRows(dynamic sem, List<ParameterDefinition> definitions, object standardizedDirect)
        {
            List<Dictionary<string, object>> rows = new List<Dictionary<string, object>>();
            foreach (ParameterDefinition definition in definitions)
            {
                double estimate = definition.Fixed ? 1.0 : Convert.ToDouble(sem.ParameterValue(definition.Label), CultureInfo.InvariantCulture);
                double standardized = Convert.ToDouble(sem.GetEstimate((dynamic)standardizedDirect, definition.Target, definition.Source), CultureInfo.InvariantCulture);
                rows.Add(new Dictionary<string, object>
                {
                    { "kind", definition.Kind },
                    { "dimension", definition.Dimension },
                    { "target", definition.Target },
                    { "source", definition.Source },
                    { "label", definition.Label },
                    { "fixed", definition.Fixed },
                    { "estimate", Clean(estimate) },
                    { "standardized", Clean(standardized) },
                    { "standardError", null },
                    { "criticalRatio", null },
                    { "pValue", null }
                });
            }
            return rows;
        }

        private static void ApplyRegressionStatistics(List<Dictionary<string, object>> rows, XmlDocument document)
        {
            Dictionary<string, RegressionStatistic> statistics = ParseRegressionWeights(document);
            foreach (Dictionary<string, object> row in rows)
            {
                if (Convert.ToBoolean(row["fixed"], CultureInfo.InvariantCulture)) continue;
                string label = Convert.ToString(row["label"], CultureInfo.InvariantCulture);
                RegressionStatistic statistic;
                if (!statistics.TryGetValue(label, out statistic))
                    throw new InvalidOperationException("Amos 回归权重表缺少参数 " + label + "。");
                if (statistic.StandardError >= 0.0 && IsFinite(statistic.StandardError))
                {
                    row["standardError"] = Clean(statistic.StandardError);
                    row["criticalRatio"] = Clean(statistic.CriticalRatio);
                    row["pValue"] = Clean(statistic.Probability);
                }
            }
        }

        private static Dictionary<string, RegressionStatistic> ParseRegressionWeights(XmlDocument document)
        {
            Dictionary<string, RegressionStatistic> values = new Dictionary<string, RegressionStatistic>(StringComparer.OrdinalIgnoreCase);
            XmlNode table = document.SelectSingleNode("//table[starts-with(@summary, 'Regression Weights:')]");
            if (table == null) throw new InvalidOperationException("Amos 输出缺少 Regression Weights 表。");
            foreach (XmlNode row in table.SelectNodes(".//tr"))
            {
                List<string> cells = row.SelectNodes("./th|./td").Cast<XmlNode>().Select(CellText).ToList();
                if (cells.Count < 8 || String.IsNullOrWhiteSpace(cells[7])) continue;
                double standardError;
                double criticalRatio;
                if (!TryParseAmosNumber(cells[4], out standardError) || !TryParseAmosNumber(cells[5], out criticalRatio)) continue;
                double probability;
                if (cells[6] == "***") probability = 0.0005;
                else if (!TryParseAmosNumber(cells[6], out probability)) probability = TwoSidedNormalP(criticalRatio);
                values[cells[7]] = new RegressionStatistic
                {
                    StandardError = standardError,
                    CriticalRatio = criticalRatio,
                    Probability = probability
                };
            }
            return values;
        }

        private static List<Dictionary<string, object>> BuildValidity(List<Dictionary<string, object>> parameters)
        {
            List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
            foreach (IGrouping<string, Dictionary<string, object>> group in parameters
                .Where(row => Convert.ToString(row["kind"], CultureInfo.InvariantCulture) == "loading")
                .GroupBy(row => Convert.ToString(row["dimension"], CultureInfo.InvariantCulture)))
            {
                List<double> loadings = group.Select(row => Convert.ToDouble(row["standardized"], CultureInfo.InvariantCulture)).ToList();
                double ave = loadings.Sum(value => value * value) / loadings.Count;
                double sum = loadings.Sum();
                double error = loadings.Sum(value => Math.Max(0.0, 1.0 - value * value));
                double compositeReliability = sum * sum / (sum * sum + error);
                result.Add(new Dictionary<string, object>
                {
                    { "dimension", group.Key }, { "items", loadings.Count },
                    { "ave", Clean(ave) }, { "compositeReliability", Clean(compositeReliability) }
                });
            }
            return result;
        }

        private static Dictionary<string, object> BuildEffects(dynamic sem, object direct, object indirect, object total,
            object standardizedDirect, object standardizedIndirect, object standardizedTotal, int bootstrapSamples,
            List<ParameterDefinition> parameters)
        {
            double directPoint = Convert.ToDouble(sem.GetEstimate((dynamic)direct, "AA", "PP"), CultureInfo.InvariantCulture);
            double indirectPoint = Convert.ToDouble(sem.GetEstimate((dynamic)indirect, "AA", "PP"), CultureInfo.InvariantCulture);
            double totalPoint = Convert.ToDouble(sem.GetEstimate((dynamic)total, "AA", "PP"), CultureInfo.InvariantCulture);
            double directStandardized = Convert.ToDouble(sem.GetEstimate((dynamic)standardizedDirect, "AA", "PP"), CultureInfo.InvariantCulture);
            double indirectStandardized = Convert.ToDouble(sem.GetEstimate((dynamic)standardizedIndirect, "AA", "PP"), CultureInfo.InvariantCulture);
            double totalStandardized = Convert.ToDouble(sem.GetEstimate((dynamic)standardizedTotal, "AA", "PP"), CultureInfo.InvariantCulture);

            Func<string, double> parameter = delegate(string label)
            {
                return Convert.ToDouble(sem.ParameterValue(label), CultureInfo.InvariantCulture);
            };
            double pcPoint = parameter("aPC") * parameter("bPC");
            double piPoint = parameter("aPI") * parameter("bPI");
            Dictionary<string, object> effects = new Dictionary<string, object>
            {
                { "direct", Effect("PP→AA", directPoint, directStandardized, null) },
                { "viaPC", Effect("PP→PC→AA", pcPoint, null, null) },
                { "viaPI", Effect("PP→PI→AA", piPoint, null, null) },
                { "totalIndirect", Effect("总间接效应", indirectPoint, indirectStandardized, null) },
                { "total", Effect("总效应", totalPoint, totalStandardized, null) }
            };
            if (bootstrapSamples <= 0) return effects;

            string[] rows = null;
            string[] columns = null;
            sem.RowNames((dynamic)direct, ref rows);
            sem.ColumnNames((dynamic)direct, ref columns);
            int aa = Array.IndexOf(rows, "AA");
            int pc = Array.IndexOf(rows, "PC");
            int pi = Array.IndexOf(rows, "PI");
            int pp = Array.IndexOf(columns, "PP");
            int pcColumn = Array.IndexOf(columns, "PC");
            int piColumn = Array.IndexOf(columns, "PI");
            if (new[] { aa, pc, pi, pp, pcColumn, piColumn }.Any(index => index < 0))
                throw new InvalidOperationException("无法在 Amos Bootstrap 直接效应矩阵中定位 PP/PC/PI/AA。");

            List<double> directSamples = new List<double>();
            List<double> pcSamples = new List<double>();
            List<double> piSamples = new List<double>();
            List<double> indirectSamples = new List<double>();
            List<double> totalSamples = new List<double>();
            for (int sample = 1; sample <= bootstrapSamples; sample++)
            {
                double[,] matrix = null;
                sem.GetBootSampleEstimates((dynamic)direct, ref matrix, sample);
                double aPc = matrix[pc, pp];
                double aPi = matrix[pi, pp];
                double bPc = matrix[aa, pcColumn];
                double bPi = matrix[aa, piColumn];
                double currentDirect = matrix[aa, pp];
                double currentPc = aPc * bPc;
                double currentPi = aPi * bPi;
                double currentIndirect = currentPc + currentPi;
                double currentTotal = currentDirect + currentIndirect;
                if (!new[] { aPc, aPi, bPc, bPi, currentDirect, currentPc, currentPi, currentIndirect, currentTotal }.All(IsFinite)) continue;
                directSamples.Add(currentDirect);
                pcSamples.Add(currentPc);
                piSamples.Add(currentPi);
                indirectSamples.Add(currentIndirect);
                totalSamples.Add(currentTotal);
            }
            int minimum = Math.Max(20, (int)Math.Ceiling(bootstrapSamples * 0.8));
            if (directSamples.Count < minimum)
                throw new InvalidOperationException("Amos Bootstrap 有效样本不足：" + directSamples.Count + "/" + bootstrapSamples + "。");
            effects["direct"] = Effect("PP→AA", directPoint, directStandardized, BootstrapSummary(directPoint, directSamples));
            effects["viaPC"] = Effect("PP→PC→AA", pcPoint, null, BootstrapSummary(pcPoint, pcSamples));
            effects["viaPI"] = Effect("PP→PI→AA", piPoint, null, BootstrapSummary(piPoint, piSamples));
            effects["totalIndirect"] = Effect("总间接效应", indirectPoint, indirectStandardized, BootstrapSummary(indirectPoint, indirectSamples));
            effects["total"] = Effect("总效应", totalPoint, totalStandardized, BootstrapSummary(totalPoint, totalSamples));
            effects["validBootstrapSamples"] = directSamples.Count;
            return effects;
        }

        private static Dictionary<string, object> Effect(string label, double estimate, double? standardized, Dictionary<string, object> bootstrap)
        {
            return new Dictionary<string, object>
            {
                { "label", label }, { "estimate", Clean(estimate) }, { "standardized", Clean(standardized) }, { "bootstrap", bootstrap }
            };
        }

        private static Dictionary<string, object> BootstrapSummary(double point, List<double> values)
        {
            List<double> sorted = values.OrderBy(value => value).ToList();
            double proportionLess = (sorted.Count(value => value < point) + 0.5 * sorted.Count(value => value == point)) / sorted.Count;
            proportionLess = Math.Max(1.0 / (2.0 * sorted.Count), Math.Min(1.0 - 1.0 / (2.0 * sorted.Count), proportionLess));
            double z0 = InverseNormal(proportionLess);
            double lowerProbability = NormalCdf(2.0 * z0 + InverseNormal(0.025));
            double upperProbability = NormalCdf(2.0 * z0 + InverseNormal(0.975));
            double lower = Quantile(sorted, lowerProbability);
            double upper = Quantile(sorted, upperProbability);
            int nonPositive = sorted.Count(value => value <= 0.0);
            int nonNegative = sorted.Count(value => value >= 0.0);
            // A finite bootstrap sample must not report an empirical p value of
            // exactly zero.  Add one pseudo-count to the smaller tail and its
            // denominator, then form the two-sided value.
            double p = Math.Min(1.0, 2.0 * (Math.Min(nonPositive, nonNegative) + 1.0) / (sorted.Count + 1.0));
            return new Dictionary<string, object>
            {
                { "lower95", Clean(lower) }, { "upper95", Clean(upper) },
                { "pValue", Clean(p) }, { "significant", lower * upper > 0.0 }, { "validSamples", sorted.Count }
            };
        }

        private static Dictionary<string, object> ParseFitIndices(XmlDocument document)
        {
            Dictionary<string, object> fit = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            AddFitRow(fit, FindTableRow(document, "CMIN", "Default model"), new[] { "NPAR", "CMIN", "DF", "P", "CMIN/DF" });
            AddFitRow(fit, FindTableRow(document, "RMR, GFI", "Default model"), new[] { "RMR", "GFI", "AGFI", "PGFI" });
            AddFitRow(fit, FindTableRow(document, "Baseline Comparisons", "Default model"), new[] { "NFI", "RFI", "IFI", "TLI", "CFI" });
            AddFitRow(fit, FindTableRow(document, "RMSEA", "Default model"), new[] { "RMSEA", "LO90", "HI90", "PCLOSE" });
            AddFitRow(fit, FindTableRow(document, "AIC", "Default model"), new[] { "AIC", "BCC", "BIC", "CAIC" });
            foreach (string required in new[] { "CMIN", "DF", "P", "CMIN/DF", "GFI", "AGFI", "PGFI", "NFI", "RFI", "IFI", "TLI", "CFI", "RMSEA" })
                if (!fit.ContainsKey(required)) throw new InvalidOperationException("Amos 输出缺少拟合指标 " + required + "。");
            return fit;
        }

        private static void AddFitRow(Dictionary<string, object> target, List<string> cells, string[] names)
        {
            if (cells == null || cells.Count < names.Length + 1) return;
            for (int index = 0; index < names.Length; index++)
            {
                double value;
                if (TryParseAmosNumber(cells[index + 1], out value)) target[names[index]] = Clean(value);
            }
        }

        private static List<string> FindTableRow(XmlDocument document, string summaryPrefix, string rowName)
        {
            XmlNode table = document.SelectSingleNode("//table[starts-with(@summary, " + XPathLiteral(summaryPrefix) + ")]");
            if (table == null) return null;
            foreach (XmlNode row in table.SelectNodes(".//tr"))
            {
                List<string> cells = row.SelectNodes("./th|./td").Cast<XmlNode>().Select(CellText).ToList();
                if (cells.Count > 0 && String.Equals(cells[0], rowName, StringComparison.OrdinalIgnoreCase)) return cells;
            }
            return null;
        }

        private static Dictionary<string, double> ParseSquaredMultipleCorrelations(XmlDocument document)
        {
            Dictionary<string, double> values = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            XmlNode table = document.SelectSingleNode("//table[starts-with(@summary, 'Squared Multiple Correlations:')]");
            if (table == null) return values;
            foreach (XmlNode row in table.SelectNodes(".//tr"))
            {
                List<string> cells = row.SelectNodes("./th|./td").Cast<XmlNode>().Select(CellText).ToList();
                double value;
                if (cells.Count >= 2 && TryParseAmosNumber(cells[cells.Count - 1], out value) && !String.Equals(cells[0], "Estimate", StringComparison.OrdinalIgnoreCase))
                    values[cells[0]] = value;
            }
            return values;
        }

        private static string CellText(XmlNode cell)
        {
            return String.Join(" ", cell.InnerText.Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
        }

        private static string XPathLiteral(string value)
        {
            return "'" + value.Replace("'", "") + "'";
        }

        private static bool TryParseAmosNumber(string text, out double value)
        {
            string normalized = (text ?? String.Empty).Trim().Replace("−", "-");
            if (normalized.StartsWith(".", StringComparison.Ordinal)) normalized = "0" + normalized;
            if (normalized.StartsWith("-.", StringComparison.Ordinal)) normalized = "-0" + normalized.Substring(1);
            return Double.TryParse(normalized, NumberStyles.Float | NumberStyles.AllowThousands, CultureInfo.InvariantCulture, out value);
        }

        private static object Clean(double value)
        {
            return IsFinite(value) ? (object)value : null;
        }

        private static object Clean(double? value)
        {
            return value.HasValue && IsFinite(value.Value) ? (object)value.Value : null;
        }

        private static bool IsFinite(double value)
        {
            return !Double.IsNaN(value) && !Double.IsInfinity(value);
        }

        private static double TwoSidedNormalP(double z)
        {
            return Math.Max(0.0, Math.Min(1.0, 2.0 * (1.0 - NormalCdf(Math.Abs(z)))));
        }

        private static double NormalCdf(double value)
        {
            double sign = value < 0.0 ? -1.0 : 1.0;
            double x = Math.Abs(value) / Math.Sqrt(2.0);
            double t = 1.0 / (1.0 + 0.3275911 * x);
            double erf = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.Exp(-x * x);
            return 0.5 * (1.0 + sign * erf);
        }

        // Acklam's rational approximation.
        private static double InverseNormal(double probability)
        {
            if (probability <= 0.0 || probability >= 1.0) throw new ArgumentOutOfRangeException("probability");
            double[] a = { -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924 };
            double[] b = { -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857 };
            double[] c = { -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878 };
            double[] d = { 0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742 };
            double low = 0.02425;
            double high = 1.0 - low;
            if (probability < low)
            {
                double q = Math.Sqrt(-2.0 * Math.Log(probability));
                return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                       ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
            }
            if (probability > high)
            {
                double q = Math.Sqrt(-2.0 * Math.Log(1.0 - probability));
                return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
            }
            double centered = probability - 0.5;
            double square = centered * centered;
            return (((((a[0] * square + a[1]) * square + a[2]) * square + a[3]) * square + a[4]) * square + a[5]) * centered /
                   (((((b[0] * square + b[1]) * square + b[2]) * square + b[3]) * square + b[4]) * square + 1.0);
        }

        private static double Quantile(List<double> sorted, double probability)
        {
            probability = Math.Max(0.0, Math.Min(1.0, probability));
            double position = (sorted.Count - 1) * probability;
            int lower = (int)Math.Floor(position);
            int upper = (int)Math.Ceiling(position);
            if (lower == upper) return sorted[lower];
            return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
        }

        private static string Sha256(string path)
        {
            using (SHA256 algorithm = SHA256.Create())
            using (FileStream stream = File.OpenRead(path))
                return String.Concat(algorithm.ComputeHash(stream).Select(value => value.ToString("x2", CultureInfo.InvariantCulture)));
        }

        private static string Serialize(Dictionary<string, object> value)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = Int32.MaxValue;
            serializer.RecursionLimit = 100;
            return serializer.Serialize(value);
        }

        private static Exception Unwrap(Exception error)
        {
            Exception current = error;
            while ((current is TargetInvocationException || current is TypeInitializationException) && current.InnerException != null)
                current = current.InnerException;
            return current;
        }

        private static string SanitizeError(string message)
        {
            if (String.IsNullOrWhiteSpace(message)) return "未知 Amos Engine 错误。";
            return String.Join(" ", message.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)).Trim();
        }
    }
}
