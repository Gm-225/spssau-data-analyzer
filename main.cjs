const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { createHash, randomUUID } = require('crypto');

const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || process.argv.includes('--dev'));

console.log('[MAIN] isDev:', isDev, 'args:', process.argv);

const projectRoot = __dirname;
const caseMemoryEnabled = process.env.ANALYZER_ENABLE_CASE_MEMORY === '1';
const retainRawInput = process.env.ANALYZER_RETAIN_INPUT === '1';
let storageRoots;

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(temporaryPath, filePath);
  }
}

function artifactEntries(artifacts, jobDir) {
  return Object.entries(artifacts || {}).flatMap(([role, artifactPath]) => {
    if (typeof artifactPath !== 'string') return [];
    const resolved = path.resolve(artifactPath);
    if (!isInside(jobDir, resolved) || !fs.existsSync(resolved)) return [];
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) return [];
    return [{
      role,
      relativePath: path.relative(jobDir, resolved).replaceAll('\\', '/'),
      bytes: stat.size,
      sha256: sha256File(resolved),
    }];
  });
}

function safeFailure(code, message) {
  const normalized = String(message || '分析任务失败').replace(/[\r\n\t]+/g, ' ').trim();
  return { code, message: normalized.slice(0, 500) };
}

const REPORT_ARTIFACT_FILENAMES = {
  result: 'analysis-result.json',
  docx: '问卷数据分析报告.docx',
  pdf: '问卷数据分析报告.pdf',
  modelFigure: '研究模型图.png',
  moderationFigure: '调节效应图.png',
  amosFigure: 'AMOS结构方程模型图.png',
  amosResult: 'amos-engine-result.json',
  amosRawOutput: 'AMOS原始输出.AmosOutput.html',
};
const GENERATED_REPORT_FILENAMES = Object.values(REPORT_ARTIFACT_FILENAMES);

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function validateArtifactContent(role, artifactPath, expectedResult) {
  const buffer = fs.readFileSync(artifactPath);
  if (role === 'result' || role === 'amosResult') {
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new Error(`产物 JSON 无法解析：${role}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`产物 JSON 结构异常：${role}`);
    if (role === 'result') {
      if (!Array.isArray(parsed.tables) || !parsed.raw || typeof parsed.raw !== 'object') {
        throw new Error('结果 JSON 缺少 tables/raw 契约');
      }
      if (JSON.stringify(parsed) !== JSON.stringify(expectedResult)) {
        throw new Error('结果 JSON 与科学运行时 stdout 不一致');
      }
    }
    return;
  }
  if (role === 'docx') {
    const zipSignature = buffer.subarray(0, 4).toString('hex');
    if (zipSignature !== '504b0304'
      || !buffer.includes(Buffer.from('[Content_Types].xml'))
      || !buffer.includes(Buffer.from('word/document.xml'))) {
      throw new Error('DOCX 不是可识别的 OOXML 压缩包');
    }
    return;
  }
  if (role === 'pdf') {
    const header = buffer.subarray(0, 5).toString('latin1');
    const trailer = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
    if (header !== '%PDF-' || !trailer.includes('%%EOF')) throw new Error('PDF 文件头或结尾标记无效');
    return;
  }
  if (['modelFigure', 'moderationFigure', 'amosFigure'].includes(role)) {
    if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`PNG 文件头无效：${role}`);
    return;
  }
  if (role === 'amosRawOutput') {
    const prefix = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').toLowerCase();
    if (!prefix.includes('<!doctype html') || !prefix.includes('<html')) throw new Error('AMOS 原始输出不是可识别的 HTML');
  }
}

function validateRequiredArtifacts(artifacts, jobDir, usesAmos = false, expectedResult = null) {
  const requiredRoles = ['result', 'docx', 'pdf', ...(usesAmos ? ['amosResult', 'amosRawOutput'] : [])];
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) throw new Error('产物映射无效');
  const seenPaths = new Set();
  const validatedRoles = new Set();
  for (const [role, artifactPath] of Object.entries(artifacts)) {
    const expectedFilename = REPORT_ARTIFACT_FILENAMES[role];
    if (!expectedFilename) throw new Error(`未知产物角色：${role}`);
    if (typeof artifactPath !== 'string') throw new Error(`产物路径无效：${role}`);
    const resolved = path.resolve(artifactPath);
    const expected = path.resolve(jobDir, expectedFilename);
    if (!samePath(resolved, expected) || !isInside(jobDir, resolved) || !fs.existsSync(resolved)) {
      throw new Error(`产物无效：${role}`);
    }
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`产物类型异常：${role}`);
    if (stat.size < 1000) throw new Error(`产物大小异常：${role}`);
    const pathKey = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seenPaths.has(pathKey)) throw new Error(`产物路径重复：${role}`);
    seenPaths.add(pathKey);
    validateArtifactContent(role, resolved, expectedResult);
    sha256File(resolved);
    validatedRoles.add(role);
  }
  for (const role of requiredRoles) {
    if (!validatedRoles.has(role)) throw new Error(`必需产物角色缺失：${role}`);
  }
  for (const [role, filename] of Object.entries(REPORT_ARTIFACT_FILENAMES)) {
    if (fs.existsSync(path.join(jobDir, filename)) && !validatedRoles.has(role)) {
      throw new Error(`任务目录存在未追溯产物：${filename}`);
    }
  }
}

function removeGeneratedFailureArtifacts(jobDir) {
  const removed = [];
  const failed = [];
  for (const filename of GENERATED_REPORT_FILENAMES) {
    const candidate = path.resolve(jobDir, filename);
    if (!isInside(jobDir, candidate) || path.dirname(candidate) !== path.resolve(jobDir) || !fs.existsSync(candidate)) continue;
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() && !stat.isSymbolicLink()) {
        failed.push(`${filename}:unsafe-type`);
        continue;
      }
      fs.unlinkSync(candidate);
      removed.push(filename);
    } catch (error) {
      failed.push(`${filename}:${error.code || 'delete-failed'}`);
    }
  }
  return { removed, failed };
}

function removePipelineStaging(jobDir) {
  const stagingDir = path.resolve(jobDir, '.pipeline-staging');
  if (!isInside(jobDir, stagingDir) || path.dirname(stagingDir) !== path.resolve(jobDir) || !fs.existsSync(stagingDir)) {
    return { removed: false, failure: null };
  }
  try {
    const stat = fs.lstatSync(stagingDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(stagingDir);
    } else if (stat.isDirectory()) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } else {
      return { removed: false, failure: 'unsafe-type' };
    }
    return { removed: true, failure: null };
  } catch (error) {
    return { removed: false, failure: error.code || 'delete-failed' };
  }
}

function writePackagedE2eProvenance() {
  const provenancePath = process.env.ANALYZER_E2E_PROVENANCE_PATH;
  if (process.env.ANALYZER_PACKAGED_E2E !== '1' || !provenancePath || !app.isPackaged) return;
  const resolvedPath = path.resolve(provenancePath);
  const payload = {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    pid: process.pid,
    parentPid: process.ppid,
    execPath: process.execPath,
    argv: process.argv,
    resourcesPath: process.resourcesPath,
    appIsPackaged: app.isPackaged,
    portable: {
      executableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
      executableFile: process.env.PORTABLE_EXECUTABLE_FILE || null,
      executableAppFilename: process.env.PORTABLE_EXECUTABLE_APP_FILENAME || null,
    },
  };
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const temporaryPath = `${resolvedPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temporaryPath, resolvedPath);
}

function getStorageRoots() {
  if (storageRoots) return storageRoots;
  const defaultDataRoot = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(projectRoot, 'data');
  storageRoots = {
    reportsRoot: path.resolve(process.env.ANALYZER_REPORTS_ROOT || path.join(defaultDataRoot, 'reports')),
    knowledgeRoot: path.resolve(process.env.ANALYZER_KNOWLEDGE_ROOT || path.join(defaultDataRoot, 'knowledge')),
  };
  return storageRoots;
}

function sha256File(filePath) {
  const digest = createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex').toUpperCase();
}

function runtimeError(kind) {
  if (kind === 'missing') {
    return new Error('科学计算运行时缺失，请重新安装或重新解压完整程序。');
  }
  return new Error('科学计算运行时已损坏或无法启动，请重新安装程序。');
}

function amosConfigPath() {
  const localAppData = process.env.LOCALAPPDATA || app.getPath('userData');
  return path.join(localAppData, 'AI-Data-Analyzer', 'amos-engine.json');
}

function isValidAmosHome(candidate) {
  return typeof candidate === 'string'
    && candidate.trim().length > 0
    && fs.existsSync(path.join(path.resolve(candidate), 'Amos.EngineLib.dll'));
}

function resolveAmosHome() {
  for (const candidate of [process.env.ANALYZER_AMOS_HOME, process.env.AMOS_HOME]) {
    if (isValidAmosHome(candidate)) return path.resolve(candidate);
  }
  const configPath = amosConfigPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return isValidAmosHome(config.amosHome) ? path.resolve(config.amosHome) : null;
  } catch {
    return null;
  }
}

function saveAmosHome(amosHome) {
  const resolved = path.resolve(amosHome);
  if (!isValidAmosHome(resolved)) throw new Error('所选目录中没有 Amos.EngineLib.dll，请选择 IBM SPSS Amos 的实际安装目录');
  const configPath = amosConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({ schemaVersion: 1, amosHome: resolved }, null, 2), 'utf8');
  fs.renameSync(temporaryPath, configPath);
  return resolved;
}

function resolveRuntimeResources() {
  if (!app.isPackaged) {
    return {
      command: path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
      argumentPrefix: [path.join(projectRoot, 'services', 'questionnaire_pipeline.py')],
      pipelinePath: path.join(projectRoot, 'services', 'questionnaire_pipeline.py'),
      planPath: path.join(projectRoot, 'examples', 'questionnaire-plan.json'),
      fontDir: path.join(projectRoot, 'assets', 'fonts'),
      cwd: projectRoot,
      manifestPath: null,
      amosBridgePath: path.join(projectRoot, 'build', 'amos-bridge', 'amos-bridge.exe'),
    };
  }
  const resourcesRoot = process.resourcesPath;
  const runtimeRoot = path.join(resourcesRoot, 'runtime', 'questionnaire-engine');
  return {
    command: path.join(runtimeRoot, 'questionnaire-engine.exe'),
    argumentPrefix: [],
    pipelinePath: path.join(resourcesRoot, 'pipeline', 'questionnaire_pipeline.py'),
    planPath: path.join(resourcesRoot, 'config', 'questionnaire-plan.json'),
    fontDir: path.join(resourcesRoot, 'fonts'),
    cwd: runtimeRoot,
    manifestPath: path.join(resourcesRoot, 'runtime-manifest.json'),
    amosBridgePath: path.join(resourcesRoot, 'amos-bridge', 'amos-bridge.exe'),
    resourcesRoot,
  };
}

function validateRuntimeResources(resources) {
  for (const requiredPath of [resources.command, resources.pipelinePath, resources.planPath, resources.fontDir]) {
    if (!fs.existsSync(requiredPath)) throw runtimeError('missing');
  }
  if (!app.isPackaged) return;
  if (!resources.manifestPath || !fs.existsSync(resources.manifestPath)) throw runtimeError('missing');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resources.manifestPath, 'utf8'));
  } catch {
    throw runtimeError('damaged');
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.criticalFiles) || !manifest.criticalFiles.length) {
    throw runtimeError('damaged');
  }
  for (const entry of manifest.criticalFiles) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      throw runtimeError('damaged');
    }
    const candidate = path.resolve(resources.resourcesRoot, entry.path);
    if (!isInside(resources.resourcesRoot, candidate) || !fs.existsSync(candidate)) {
      throw runtimeError('missing');
    }
    if (sha256File(candidate) !== entry.sha256.toUpperCase()) {
      throw runtimeError('damaged');
    }
  }
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function recoverInterruptedJobs() {
  const { reportsRoot } = getStorageRoots();
  if (!fs.existsSync(reportsRoot)) return;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const entry of fs.readdirSync(reportsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !uuidPattern.test(entry.name)) continue;
    const jobDir = path.resolve(reportsRoot, entry.name);
    if (!isInside(reportsRoot, jobDir)) continue;
    const manifestPath = path.join(jobDir, 'job-manifest.json');
    if (!fs.existsSync(manifestPath) || fs.lstatSync(manifestPath).isSymbolicLink()) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (manifest.schemaVersion !== 1
      || manifest.status !== 'running'
      || manifest.jobId !== entry.name
      || manifest.app?.version !== app.getVersion()
      || manifest.privacy?.inputDisposition !== 'ephemeral'
      || manifest.privacy?.rawInputRetained !== false) continue;
    const inputPath = path.join(jobDir, 'input.json');
    let rawInputDeletedAtUtc = manifest.privacy?.rawInputDeletedAtUtc || null;
    let rawInputRetained = fs.existsSync(inputPath);
    try {
      let inputCleanupFailure = null;
      if (fs.existsSync(inputPath)) {
        const inputStat = fs.lstatSync(inputPath);
        if (inputStat.isFile() || inputStat.isSymbolicLink()) {
          try {
            fs.unlinkSync(inputPath);
          } catch (error) {
            inputCleanupFailure = error.code || 'delete-failed';
          }
        } else {
          inputCleanupFailure = 'unsafe-type';
        }
      }
      rawInputRetained = fs.existsSync(inputPath);
      if (!rawInputRetained) rawInputDeletedAtUtc = new Date().toISOString();
      const stagingCleanup = removePipelineStaging(jobDir);
      const artifactCleanup = removeGeneratedFailureArtifacts(jobDir);
      const remainingGeneratedArtifacts = GENERATED_REPORT_FILENAMES.filter((filename) => fs.existsSync(path.join(jobDir, filename)));
      const cleanupComplete = !rawInputRetained
        && !inputCleanupFailure
        && !stagingCleanup.failure
        && artifactCleanup.failed.length === 0
        && remainingGeneratedArtifacts.length === 0;
      writeJsonAtomic(manifestPath, {
        ...manifest,
        status: 'failed',
        completedAtUtc: new Date().toISOString(),
        artifacts: [],
        privacy: {
          ...manifest.privacy,
          rawInputRetained,
          rawInputDeletedAtUtc,
          caseMemoryStored: false,
        },
        cleanup: {
          inputFailure: inputCleanupFailure,
          stagingRemoved: stagingCleanup.removed,
          stagingFailure: stagingCleanup.failure,
          generatedArtifactsRemoved: artifactCleanup.removed,
          generatedArtifactDeletionFailures: artifactCleanup.failed,
          remainingGeneratedArtifacts,
        },
        failure: safeFailure(
          'INTERRUPTED',
          cleanupComplete
            ? '上次任务异常中断；已在本次启动时清理该新版任务的临时输入和未完成产物'
            : '上次任务异常中断；自动清理未完全成功，请人工检查该任务目录',
        ),
      });
    } catch {
      // Do not touch unknown or historical files when recovery cannot prove safety.
    }
  }
}

function runQuestionnairePipeline(payload) {
  return new Promise((resolve, reject) => {
    const { reportsRoot, knowledgeRoot } = getStorageRoots();
    const resources = resolveRuntimeResources();
    try {
      validateRuntimeResources(resources);
    } catch (error) {
      reject(error);
      return;
    }
    let selectedPlan;
    try {
      selectedPlan = payload.plan && typeof payload.plan === 'object' && !Array.isArray(payload.plan)
        ? payload.plan
        : JSON.parse(fs.readFileSync(resources.planPath, 'utf8'));
    } catch {
      reject(new Error('分析方案无法读取或不是有效 JSON'));
      return;
    }
    if (selectedPlan.confirmation?.confirmed !== true
      || selectedPlan.scale?.confirmed !== true
      || !Array.isArray(selectedPlan.dimensions)
      || selectedPlan.dimensions.some((dimension) => dimension.reverseItemsConfirmed !== true)
      || (Array.isArray(selectedPlan.humanConfirmations) && selectedPlan.humanConfirmations.length > 0)) {
      reject(new Error('分析方案尚未完成确认，未启动科学计算'));
      return;
    }
    const usesAmos = Array.isArray(selectedPlan.analysisOrder) && selectedPlan.analysisOrder.includes('amos');
    const amosHome = usesAmos ? resolveAmosHome() : null;
    if (usesAmos && !fs.existsSync(resources.amosBridgePath)) {
      reject(new Error('AMOS Bridge 缺失，请重新安装完整程序。'));
      return;
    }
    if (usesAmos && !amosHome) {
      reject(new Error('尚未配置本机 Amos 安装目录，请在 AI 分析页点击“配置 Amos”。'));
      return;
    }
    const jobId = randomUUID();
    const jobDir = path.join(reportsRoot, jobId);
    const inputPath = path.join(jobDir, 'input.json');
    const planPath = path.join(jobDir, 'analysis-plan.json');
    const manifestPath = path.join(jobDir, 'job-manifest.json');
    const createdAtUtc = new Date().toISOString();
    fs.mkdirSync(jobDir, { recursive: true });
    const serializedInput = JSON.stringify({
      headers: payload.headers,
      rows: payload.rows,
    });
    const serializedPlan = JSON.stringify(selectedPlan, null, 2);
    const inputSha256 = sha256Text(serializedInput);
    const planSha256 = sha256Text(serializedPlan);
    const runtimeManifestSha256 = resources.manifestPath && fs.existsSync(resources.manifestPath)
      ? sha256File(resources.manifestPath)
      : null;
    const baseManifest = {
      schemaVersion: 1,
      jobId,
      status: 'running',
      createdAtUtc,
      completedAtUtc: null,
      app: {
        name: 'AI Data Analyzer',
        version: app.getVersion(),
        releaseId: process.env.ANALYZER_RELEASE_ID || `v${app.getVersion()}`,
      },
      engine: {
        id: usesAmos ? 'questionnaire-pipeline+ibm-amos' : 'questionnaire-pipeline',
        version: '2.1',
        runtimeManifestSha256,
      },
      input: {
        sha256: inputSha256,
        rowCount: payload.rows.length,
        columnCount: payload.headers.length,
      },
      plan: {
        sha256: planSha256,
        schemaVersion: selectedPlan.schemaVersion || null,
        confirmedAtUtc: selectedPlan.confirmation?.confirmedAtUtc || null,
      },
      execution: {
        requestedScope: selectedPlan.analysisOrder,
        modelType: selectedPlan.model?.type || 'none',
        scaleRange: [selectedPlan.scale?.min, selectedPlan.scale?.max],
        missingPolicy: selectedPlan.scale?.missingPolicy || null,
        bootstrapSamples: selectedPlan.model?.bootstrapSamples || null,
      },
      artifacts: [],
      privacy: {
        inputDisposition: retainRawInput ? 'retained' : 'ephemeral',
        rawInputRetained: retainRawInput,
        rawInputDeletedAtUtc: null,
        caseMemoryStored: false,
      },
    };
    writeJsonAtomic(manifestPath, baseManifest);

    const finishInputRetention = () => {
      if (retainRawInput) {
        return { rawInputRetained: fs.existsSync(inputPath), rawInputDeletedAtUtc: null, cleanupError: null };
      }
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        return { rawInputRetained: false, rawInputDeletedAtUtc: new Date().toISOString(), cleanupError: null };
      } catch (error) {
        return { rawInputRetained: fs.existsSync(inputPath), rawInputDeletedAtUtc: null, cleanupError: error };
      }
    };

    const finalizeFailure = (code, message, artifacts = {}) => {
      const retention = finishInputRetention();
      const stagingCleanup = removePipelineStaging(jobDir);
      const artifactCleanup = removeGeneratedFailureArtifacts(jobDir);
      const remainingGeneratedArtifacts = GENERATED_REPORT_FILENAMES.filter((filename) => fs.existsSync(path.join(jobDir, filename)));
      let failure = safeFailure(code, message);
      if (retention.cleanupError) {
        failure = safeFailure('INPUT_CLEANUP_FAILED', '分析失败，且临时原始输入未能自动删除；请关闭程序后人工处理该任务目录');
      } else if (stagingCleanup.failure || artifactCleanup.failed.length || remainingGeneratedArtifacts.length) {
        failure = safeFailure('OUTPUT_CLEANUP_FAILED', '分析失败，且未完成产物未能全部自动删除；请人工检查该任务目录');
      }
      try {
        writeJsonAtomic(manifestPath, {
          ...baseManifest,
          status: 'failed',
          completedAtUtc: new Date().toISOString(),
          artifacts: artifactEntries(artifacts, jobDir),
          privacy: {
            ...baseManifest.privacy,
            rawInputRetained: retention.rawInputRetained,
            rawInputDeletedAtUtc: retention.rawInputDeletedAtUtc,
            caseMemoryStored: false,
          },
          cleanup: {
            stagingRemoved: stagingCleanup.removed,
            stagingFailure: stagingCleanup.failure,
            generatedArtifactsRemoved: artifactCleanup.removed,
            generatedArtifactDeletionFailures: artifactCleanup.failed,
            remainingGeneratedArtifacts,
          },
          failure,
        });
      } catch {
        reject(new Error('分析任务失败，且追溯清单未能完成更新；请重启应用触发安全恢复'));
        return;
      }
      reject(new Error(failure.message));
    };

    try {
      fs.writeFileSync(planPath, serializedPlan, 'utf8');
      fs.writeFileSync(inputPath, serializedInput, 'utf8');
    } catch {
      finalizeFailure('TASK_INITIALIZATION_ERROR', '分析任务临时文件初始化失败');
      return;
    }

    const args = [...resources.argumentPrefix, '--input-json', inputPath, '--plan', planPath, '--output-dir', jobDir];
    execFile(resources.command, args, {
      cwd: resources.cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 30 * 1024 * 1024,
      env: {
        ...process.env,
        OPENBLAS_NUM_THREADS: '1',
        OMP_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
        ANALYZER_FONT_DIR: resources.fontDir,
        ANALYZER_AMOS_BRIDGE: usesAmos ? resources.amosBridgePath : '',
        ANALYZER_AMOS_HOME: amosHome || '',
        ANALYZER_ALLOW_TEST_OVERRIDES: process.env.ANALYZER_ALLOW_TEST_OVERRIDES === '1' ? '1' : '',
        ANALYZER_AMOS_BOOTSTRAP_SAMPLES: process.env.ANALYZER_ALLOW_TEST_OVERRIDES === '1'
          ? (process.env.ANALYZER_AMOS_BOOTSTRAP_SAMPLES || '')
          : '',
      },
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          finalizeFailure('RUNTIME_MISSING', runtimeError('missing').message);
          return;
        }
        const rawMessage = (stderr || stdout || error.message).trim();
        const lastLine = rawMessage.split(/\r?\n/).filter(Boolean).at(-1) || rawMessage;
        const businessError = lastLine.match(/^(?:ValueError|RuntimeError):\s*(.+)$/);
        if (businessError) {
          finalizeFailure('VALIDATION_ERROR', businessError[1]);
        } else {
          finalizeFailure('RUNTIME_ERROR', runtimeError('damaged').message);
        }
        return;
      }
      let response;
      try {
        response = JSON.parse(stdout.trim());
      } catch (parseError) {
        finalizeFailure('OUTPUT_PARSE_ERROR', `分析结果解析失败：${parseError.message}`);
        return;
      }
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || !response.result || typeof response.result !== 'object' || Array.isArray(response.result)
        || !Array.isArray(response.result.tables)
        || !response.artifacts || typeof response.artifacts !== 'object' || Array.isArray(response.artifacts)) {
        finalizeFailure('OUTPUT_CONTRACT_ERROR', '科学运行时返回的结果结构不完整', response?.artifacts);
        return;
      }
      try {
        validateRequiredArtifacts(response.artifacts, jobDir, usesAmos, response.result);
      } catch (artifactError) {
        finalizeFailure('ARTIFACT_VALIDATION_FAILED', artifactError.message, response.artifacts);
        return;
      }
      const retention = finishInputRetention();
      if (retention.cleanupError) {
        finalizeFailure('INPUT_CLEANUP_FAILED', '报告已生成，但临时原始输入未能自动删除；本任务已标记失败', response.artifacts);
        return;
      }
      let caseMemoryStored = false;
      let caseMemoryFailure = null;
      if (caseMemoryEnabled) {
        try {
          fs.mkdirSync(knowledgeRoot, { recursive: true });
          const memory = {
            caseId: jobId,
            createdAt: new Date().toISOString(),
            engine: usesAmos ? 'questionnaire-pipeline-v1+ibm-amos-engine' : 'questionnaire-pipeline-v1',
            rowCount: payload.rows.length,
            columnCount: payload.headers.length,
            inputSha256,
            planSha256,
            status: 'verified-output-generated',
          };
          fs.appendFileSync(path.join(knowledgeRoot, 'analysis-cases.jsonl'), `${JSON.stringify(memory)}\n`, 'utf8');
          caseMemoryStored = true;
        } catch {
          caseMemoryFailure = safeFailure('CASE_MEMORY_WRITE_FAILED', '案例记忆已启用，但本次未能写入；报告本身仍有效');
        }
      }
      const manifest = {
        ...baseManifest,
        status: 'succeeded',
        completedAtUtc: new Date().toISOString(),
        execution: {
          ...baseManifest.execution,
          actualScope: response.result?.raw?.analysisScope || [],
          seed: response.result?.raw?.seed ?? null,
          actualBootstrapSamples: response.result?.raw?.amos?.bootstrap?.samplesRequested
            ?? response.result?.raw?.bootstrapSamples
            ?? null,
        },
        artifacts: artifactEntries(response.artifacts, jobDir),
        privacy: {
          ...baseManifest.privacy,
          rawInputRetained: retention.rawInputRetained,
          rawInputDeletedAtUtc: retention.rawInputDeletedAtUtc,
          caseMemoryStored,
          caseMemoryFailure,
        },
      };
      try {
        writeJsonAtomic(manifestPath, manifest);
      } catch {
        finalizeFailure('MANIFEST_WRITE_FAILED', '报告已生成，但成功状态和产物哈希未能写入追溯清单', response.artifacts);
        return;
      }
      resolve({
        ...response,
        artifacts: { ...response.artifacts, manifest: manifestPath },
        caseMemory: { caseId: jobId, stored: caseMemoryStored, failure: caseMemoryFailure },
        job: {
          jobId,
          status: 'succeeded',
          manifestPath,
          rawInputRetained: retention.rawInputRetained,
          caseMemoryStored,
        },
      });
    });
  });
}

ipcMain.handle('analysis:run-questionnaire', (_event, payload) => {
  if (!payload || !Array.isArray(payload.headers) || !Array.isArray(payload.rows)) {
    throw new Error('数据格式无效');
  }
  return runQuestionnairePipeline(payload);
});

ipcMain.handle('analysis:open-artifact', async (_event, artifactPath) => {
  const { reportsRoot } = getStorageRoots();
  if (typeof artifactPath !== 'string' || !isInside(reportsRoot, artifactPath)) {
    throw new Error('拒绝打开分析器输出目录以外的文件');
  }
  if (!fs.existsSync(artifactPath)) throw new Error('报告文件不存在');
  const message = await shell.openPath(artifactPath);
  if (message) throw new Error(message);
  return true;
});

ipcMain.handle('analysis:get-amos-status', () => {
  const resources = resolveRuntimeResources();
  const amosHome = resolveAmosHome();
  return {
    configured: Boolean(amosHome),
    amosHome,
    bridgeReady: fs.existsSync(resources.amosBridgePath),
    configPath: amosConfigPath(),
  };
});

ipcMain.handle('analysis:configure-amos', async () => {
  const selection = await dialog.showOpenDialog({
    title: '选择 IBM SPSS Amos 安装目录',
    properties: ['openDirectory'],
  });
  if (selection.canceled || !selection.filePaths.length) return { canceled: true };
  const amosHome = saveAmosHome(selection.filePaths[0]);
  return { canceled: false, configured: true, amosHome };
});

function createWindow() {
  console.log('[MAIN] Creating window...');
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.join(__dirname, 'assets', 'branding', 'app-icon-1024.png');
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
    titleBarStyle: 'default',
    show: false,
    autoHideMenuBar: true,
  });

  console.log('[MAIN] Window created, loading content...');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[MAIN] Page loaded successfully');
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[MAIN] Page load failed:', code, desc);
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[MAIN] ready-to-show, showing window');
    mainWindow.show();
    mainWindow.focus();
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [mainWindow] = BrowserWindow.getAllWindows();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    console.log('[MAIN] App ready');
    writePackagedE2eProvenance();
    recoverInterruptedJobs();
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.spssau.desktop');
    }
    createWindow();
    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', function () {
  console.log('[MAIN] All windows closed');
  if (process.platform !== 'darwin') app.quit();
});
