from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import re
import time
from xml.sax.saxutils import escape
from pathlib import Path
from typing import Any

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as font_manager
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Ellipse, FancyArrowPatch, Rectangle
import numpy as np
import pandas as pd
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image as PdfImage,
    KeepTogether,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    TableStyle,
)
from scipy import stats

rl_config.invariant = 1


class OLSResult:
    def __init__(self, y: pd.Series, x: pd.DataFrame):
        names = ["const", *x.columns.tolist()]
        matrix = np.column_stack([np.ones(len(x)), x.to_numpy(dtype=float)])
        target = y.to_numpy(dtype=float)
        beta = np.linalg.lstsq(matrix, target, rcond=None)[0]
        residuals = target - matrix @ beta
        self.nobs = len(target)
        self.df_resid = len(target) - matrix.shape[1]
        self.df_model = matrix.shape[1] - 1
        sse = float(residuals @ residuals)
        centered = target - target.mean()
        sst = float(centered @ centered)
        self.rsquared = 1 - sse / sst if sst else 0.0
        self.rsquared_adj = 1 - (1 - self.rsquared) * (len(target) - 1) / self.df_resid
        self.fvalue = (self.rsquared / self.df_model) / ((1 - self.rsquared) / self.df_resid) if self.df_model and self.rsquared < 1 else math.inf
        self.f_pvalue = float(stats.f.sf(self.fvalue, self.df_model, self.df_resid))
        sigma2 = float(sse / self.df_resid)
        covariance = sigma2 * np.linalg.pinv(matrix.T @ matrix)
        standard_errors = np.sqrt(np.diag(covariance))
        t_values = beta / standard_errors
        p_values = 2 * stats.t.sf(np.abs(t_values), self.df_resid)
        self.params = pd.Series(beta, index=names)
        self.bse = pd.Series(standard_errors, index=names)
        self.tvalues = pd.Series(t_values, index=names)
        self.pvalues = pd.Series(p_values, index=names)
        self._covariance = pd.DataFrame(covariance, index=names, columns=names)

    def cov_params(self) -> pd.DataFrame:
        return self._covariance


def ols(y: pd.Series, x: pd.DataFrame) -> OLSResult:
    return OLSResult(y, x)


def read_data(args: argparse.Namespace) -> pd.DataFrame:
    if args.input:
        input_path = Path(args.input)
        if input_path.suffix.lower() == ".csv":
            return pd.read_csv(input_path, encoding="utf-8-sig")
        return pd.read_excel(input_path)
    payload = json.loads(Path(args.input_json).read_text(encoding="utf-8"))
    if not isinstance(payload.get("headers"), list) or not isinstance(payload.get("rows"), list):
        raise ValueError("输入 JSON 必须包含 headers 和 rows 数组")
    return pd.DataFrame(payload["rows"], columns=payload["headers"])


def item_columns(frame: pd.DataFrame, dimension: dict[str, Any]) -> list[str]:
    prefix = str(dimension["columnPrefix"])
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)(?:_.+)?$", re.IGNORECASE)
    planned_items = dimension.get("items")
    if not isinstance(planned_items, list) or not planned_items:
        raise ValueError(f"维度 {prefix} 缺少已确认的精确题项列表")
    columns = [str(column) for column in planned_items]
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"维度 {prefix} 有 {len(missing)} 个已确认题项不在数据中")
    invalid = [column for column in columns if not pattern.fullmatch(column)]
    if invalid:
        raise ValueError(f"维度 {prefix} 有 {len(invalid)} 个题项不符合“前缀+连续编号”命名契约")
    columns.sort(key=lambda column: (int(pattern.fullmatch(column).group(1)), column))
    if len(columns) != dimension["expectedItems"]:
        raise ValueError(f"维度 {prefix} 期望 {dimension['expectedItems']} 个题项，实际识别 {len(columns)} 个")
    indices = [int(pattern.fullmatch(column).group(1)) for column in columns]
    if indices != list(range(1, dimension["expectedItems"] + 1)):
        raise ValueError(f"维度 {prefix} 的题项编号必须从 1 连续到 {dimension['expectedItems']}")
    return columns


def validate_plan(plan: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(plan, dict):
        raise ValueError("分析方案必须是 JSON 对象")
    if plan.get("schemaVersion") != "2.0":
        raise ValueError("当前科学管线仅接受 schemaVersion=2.0 的确认方案")
    confirmation = plan.get("confirmation")
    if not isinstance(confirmation, dict) or confirmation.get("confirmed") is not True or not str(confirmation.get("confirmedAtUtc", "")).strip():
        raise ValueError("分析方案尚未由操作者确认")
    confirmations = plan.get("humanConfirmations", [])
    if not isinstance(confirmations, list) or confirmations:
        raise ValueError("分析方案仍有未解决的人工确认项")
    dimensions = plan.get("dimensions")
    if not isinstance(dimensions, list) or not dimensions:
        raise ValueError("分析方案至少需要一个量表维度")
    seen: set[str] = set()
    seen_items: set[str] = set()
    for dimension in dimensions:
        if not isinstance(dimension, dict):
            raise ValueError("每个量表维度必须是对象")
        dim_id = str(dimension.get("id", "")).strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", dim_id):
            raise ValueError(f"维度 ID 无效：{dim_id or '空'}；请使用英文字母开头的编号")
        if dim_id in seen:
            raise ValueError(f"维度 ID 重复：{dim_id}")
        seen.add(dim_id)
        dimension["id"] = dim_id
        if not str(dimension.get("name", "")).strip():
            dimension["name"] = dim_id
        if not str(dimension.get("columnPrefix", "")).strip():
            dimension["columnPrefix"] = dim_id
        expected = dimension.get("expectedItems")
        if not isinstance(expected, int) or expected < 2:
            raise ValueError(f"维度 {dim_id} 至少需要 2 个题项")
        items = dimension.get("items")
        if not isinstance(items, list) or len(items) != expected or any(not isinstance(item, str) or not item.strip() for item in items):
            raise ValueError(f"维度 {dim_id} 必须提供与 expectedItems 一致的精确题项列表")
        if len(set(items)) != len(items):
            raise ValueError(f"维度 {dim_id} 的题项列表存在重复")
        overlap = seen_items.intersection(items)
        if overlap:
            raise ValueError(f"题项不能跨维度重复：{len(overlap)} 个冲突")
        seen_items.update(items)
        reverse_items = dimension.get("reverseItems", [])
        if not isinstance(reverse_items, list):
            raise ValueError(f"维度 {dim_id} 的 reverseItems 必须是数组")
        if dimension.get("reverseItemsConfirmed") is not True:
            raise ValueError(f"维度 {dim_id} 的反向题尚未确认")
        invalid_reverse = [item for item in reverse_items if item not in items]
        if invalid_reverse:
            raise ValueError(f"维度 {dim_id} 有 {len(invalid_reverse)} 个反向题不属于该维度")
        if len(set(reverse_items)) != len(reverse_items):
            raise ValueError(f"维度 {dim_id} 的反向题不能重复")
    scale = plan.get("scale")
    if not isinstance(scale, dict) or not isinstance(scale.get("min"), (int, float)) or not isinstance(scale.get("max"), (int, float)):
        raise ValueError("分析方案必须提供有效的量表最小值和最大值")
    if scale["min"] >= scale["max"]:
        raise ValueError("量表最大值必须大于最小值")
    if not float(scale["min"]).is_integer() or not float(scale["max"]).is_integer():
        raise ValueError("量表最小值和最大值必须是整数")
    if scale["max"] - scale["min"] > 20:
        raise ValueError("量表范围跨度不能超过 20")
    if scale.get("confirmed") is not True:
        raise ValueError("量表范围尚未由操作者确认")
    if scale.get("missingPolicy") != "dimension-mean-requires-all-items":
        raise ValueError("当前版本仅支持维度全部题项有效时计算维度均值")
    demographics = plan.get("demographics", [])
    if not isinstance(demographics, list):
        raise ValueError("demographics 必须是数组")
    demographic_columns: list[str] = []
    for demographic in demographics:
        if not isinstance(demographic, dict) or not str(demographic.get("column", "")).strip() or not isinstance(demographic.get("labels", {}), dict):
            raise ValueError("每个人口学变量必须提供 column 和 labels")
        demographic_columns.append(str(demographic["column"]))
    if len(set(demographic_columns)) != len(demographic_columns):
        raise ValueError("人口学变量不能重复")
    if seen_items.intersection(demographic_columns):
        raise ValueError("量表题项不能同时作为人口学变量")
    excluded_columns = plan.get("excludedColumns", [])
    if not isinstance(excluded_columns, list) or any(not isinstance(column, str) for column in excluded_columns):
        raise ValueError("excludedColumns 必须是字符串数组")
    if len(set(excluded_columns)) != len(excluded_columns):
        raise ValueError("excludedColumns 不能重复")
    allowed_steps = {"data-quality", "frequency", "item-descriptive", "reliability", "efa", "dimension-correlation", "model", "amos"}
    analysis_order = plan.get("analysisOrder")
    if not isinstance(analysis_order, list) or not analysis_order or analysis_order[0] != "data-quality":
        raise ValueError("analysisOrder 必须以 data-quality 开始")
    unknown_steps = [step for step in analysis_order if step not in allowed_steps]
    if unknown_steps or len(set(analysis_order)) != len(analysis_order):
        raise ValueError("analysisOrder 包含未知或重复步骤")
    if "frequency" in analysis_order and not demographics:
        raise ValueError("执行人口学频数前必须显式选择至少一个人口学字段")
    model = plan.get("model", {"type": "none"})
    if not isinstance(model, dict):
        raise ValueError("model 必须是对象")
    model_type = model.get("type", "none")
    if model_type not in {"none", "multiple-regression", "parallel-mediation-with-direct-path-moderation"}:
        raise ValueError(f"暂不支持的研究模型类型：{model_type}")
    controls = model.get("controls") or []
    centering = model.get("centering") or []
    if not isinstance(controls, list) or not isinstance(centering, list):
        raise ValueError("模型 controls 和 centering 必须是数组")
    referenced = [model.get("x"), model.get("y"), model.get("moderator"), *(model.get("predictors") or []), *(model.get("parallelMediators") or []), *controls, *centering]
    unknown = sorted({str(value) for value in referenced if value and str(value) not in seen})
    if unknown:
        raise ValueError(f"研究模型引用了未定义维度：{', '.join(unknown)}")
    predictors = model.get("predictors") or []
    if len(set(predictors)) != len(predictors):
        raise ValueError("回归预测变量不能重复")
    if model.get("y") and (model.get("y") == model.get("x") or model.get("y") in predictors):
        raise ValueError("因变量不能同时作为自变量或预测变量")
    if "model" in analysis_order and model_type == "none":
        raise ValueError("执行研究模型前必须确认模型角色")
    if model_type == "multiple-regression" and (not model.get("y") or not predictors):
        raise ValueError("多元回归必须提供因变量和至少一个预测变量")
    if controls:
        raise ValueError("当前通用回归尚未验证控制变量契约，请不要把控制变量静默加入模型")
    if model_type == "multiple-regression" and centering:
        raise ValueError("当前通用回归不支持未验证的自动中心化选项")
    if model_type == "parallel-mediation-with-direct-path-moderation":
        fixed_contract = (
            model.get("x") == "PP"
            and model.get("y") == "AA"
            and model.get("parallelMediators") == ["PC", "PI"]
            and model.get("moderator") == "PV"
            and model.get("moderatedPath") == "PP->AA"
            and model.get("predictors") == ["PP", "PC", "PI", "PV"]
            and centering == ["PP", "PV"]
        )
        if not fixed_contract:
            raise ValueError("高级中介/调节当前仅支持已验证的 PP→AA、PC/PI 并行中介、PV 调节直接路径固定契约")
        expected_counts = {"PP": 4, "AA": 3, "PC": 4, "PI": 5, "PV": 4}
        actual_counts = {dimension["id"]: dimension["expectedItems"] for dimension in dimensions}
        if actual_counts != expected_counts:
            raise ValueError("高级中介/调节固定契约要求 PP4、AA3、PC4、PI5、PV4 共 20 个题项")
        bootstrap_samples = model.get("bootstrapSamples")
        if bootstrap_samples != 5000:
            raise ValueError("高级模型当前仅验证 5000 次 Bootstrap")
        confidence_level = model.get("confidenceLevel")
        if confidence_level != 0.95:
            raise ValueError("高级模型当前仅验证 95% 置信水平")
    if "amos" in analysis_order and model_type != "parallel-mediation-with-direct-path-moderation":
        raise ValueError("AMOS/CFA/SEM 当前仅支持已验证的固定问卷契约")
    plan.setdefault("title", "问卷数据分析")
    plan.setdefault("schemaVersion", "2.0")
    plan.setdefault("demographics", [])
    plan["model"] = model
    return plan


def alpha(values: pd.DataFrame) -> float:
    values = values.dropna()
    k = values.shape[1]
    total_var = values.sum(axis=1).var(ddof=1)
    return float(k / (k - 1) * (1 - values.var(ddof=1).sum() / total_var))


def varimax(loadings: np.ndarray, gamma: float = 1.0, iterations: int = 100, tol: float = 1e-7) -> np.ndarray:
    p, k = loadings.shape
    rotation = np.eye(k)
    previous = 0.0
    for _ in range(iterations):
        transformed = loadings @ rotation
        u, singular, vh = np.linalg.svd(loadings.T @ (transformed ** 3 - (gamma / p) * transformed @ np.diag(np.diag(transformed.T @ transformed))))
        rotation = u @ vh
        current = float(singular.sum())
        if previous and current / previous < 1 + tol:
            break
        previous = current
    return loadings @ rotation


def fmt(value: Any, digits: int = 3) -> str:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return "-"
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    return f"{float(value):.{digits}f}"


def p_fmt(value: float) -> str:
    return "<0.001" if value < 0.001 else f"{value:.3f}"


def json_default(value: Any):
    if isinstance(value, np.integer): return int(value)
    if isinstance(value, np.floating): return float(value)
    if isinstance(value, np.ndarray): return value.tolist()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def table(title: str, headers: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    return {"title": title, "type": "table", "headers": headers, "rows": [[fmt(v) if isinstance(v, (float, np.floating)) else v for v in row] for row in rows]}


def text(title: str, content: str) -> dict[str, Any]:
    return {"title": title, "type": "text", "headers": [], "rows": [[content]]}


def prompt_requests_amos(prompt: str) -> bool:
    return bool(re.search(r"\bamos\b|\bsem\b|\bcfa\b|结构方程|验证性因子", prompt.strip().lower()))


def validate_amos_v1_contract(frame: pd.DataFrame, plan: dict[str, Any]) -> list[tuple[dict[str, Any], list[str]]]:
    expected_dimensions = [("PP", 4), ("AA", 3), ("PC", 4), ("PI", 5), ("PV", 4)]
    actual_dimensions = [(str(dim.get("id", "")), int(dim.get("expectedItems", 0))) for dim in plan.get("dimensions", [])]
    if actual_dimensions != expected_dimensions:
        raise ValueError(
            "AMOS V1 当前仅支持固定五维方案 PP(4)、AA(3)、PC(4)、PI(5)、PV(4)；"
            "当前方案与本机 Amos 模型契约不一致，未生成报告"
        )
    model = plan.get("model", {})
    if (
        model.get("x") != "PP"
        or model.get("y") != "AA"
        or model.get("parallelMediators") != ["PC", "PI"]
        or model.get("moderator") != "PV"
        or model.get("moderatedPath") != "PP->AA"
    ):
        raise ValueError("AMOS V1 固定结构要求 X=PP、Y=AA、并行中介=PC+PI、PV 为 AA 主效应；当前方案不匹配")
    resolved: list[tuple[dict[str, Any], list[str]]] = []
    for dimension, (_, expected_count) in zip(plan["dimensions"], expected_dimensions):
        columns = item_columns(frame, dimension)
        aliases = [str(column).split("_", 1)[0] for column in columns]
        expected_aliases = [f"{dimension['id']}{index}" for index in range(1, expected_count + 1)]
        if aliases != expected_aliases:
            raise ValueError(
                f"AMOS V1 题项契约不匹配：{dimension['id']} 需要 {', '.join(expected_aliases)}，"
                f"实际识别为 {', '.join(aliases) or '无'}"
            )
        resolved.append((dimension, columns))
    return resolved


def run_amos_analysis(frame: pd.DataFrame, plan: dict[str, Any], staging_dir: Path, seed: int) -> tuple[dict[str, Any], list[Path]]:
    bridge_value = os.environ.get("ANALYZER_AMOS_BRIDGE", "").strip()
    amos_home_value = os.environ.get("ANALYZER_AMOS_HOME", "").strip()
    if not bridge_value:
        raise RuntimeError("AMOS Bridge 未安装，请重新构建或重新安装完整程序")
    if not amos_home_value:
        raise RuntimeError("尚未配置本机 Amos 安装目录，请在 AI 分析页选择包含 Amos.EngineLib.dll 的目录")
    bridge = Path(bridge_value).resolve()
    amos_home = Path(amos_home_value).resolve()
    if not bridge.is_file():
        raise RuntimeError(f"AMOS Bridge 缺失：{bridge}")
    if not (amos_home / "Amos.EngineLib.dll").is_file():
        raise RuntimeError(f"所选目录不是有效的 Amos 安装目录：{amos_home}")

    if len(frame) < 100:
        raise ValueError(f"AMOS CFA/SEM 当前至少需要 100 份完整样本，实际为 {len(frame)} 份")
    aliases: dict[str, pd.Series] = {}
    scale_min, scale_max = plan["scale"]["min"], plan["scale"]["max"]
    for dimension, columns in validate_amos_v1_contract(frame, plan):
        reverse_items = set(str(item) for item in dimension.get("reverseItems", []))
        for index, column in enumerate(columns, start=1):
            alias = f"{dimension['id']}{index}"
            values = pd.to_numeric(frame[column], errors="coerce")
            if values.isna().any():
                raise ValueError(f"AMOS V1 暂不接受题项缺失或非数值：{column}；请先完成缺失值处理")
            if str(column) in reverse_items or alias in reverse_items:
                values = scale_min + scale_max - values
            aliases[alias] = values
    amos_frame = pd.DataFrame(aliases)
    input_path = (staging_dir / "amos-input.xlsx").resolve()
    bridge_result_path = (staging_dir / "amos-engine-result.json").resolve()
    raw_output_path = (staging_dir / "AMOS原始输出.AmosOutput.html").resolve()
    amos_frame.to_excel(input_path, index=False, sheet_name="data")

    configured_bootstrap = os.environ.get("ANALYZER_AMOS_BOOTSTRAP_SAMPLES", "").strip()
    allow_test_override = os.environ.get("ANALYZER_ALLOW_TEST_OVERRIDES") == "1"
    if configured_bootstrap and not allow_test_override:
        raise RuntimeError("生产主线禁止通过环境变量覆盖已确认方案的 AMOS Bootstrap 次数")
    bootstrap_samples = int(configured_bootstrap) if configured_bootstrap else int(plan["model"].get("bootstrapSamples", 5000))
    if bootstrap_samples < 0 or bootstrap_samples > 20000:
        raise RuntimeError("测试态 ANALYZER_AMOS_BOOTSTRAP_SAMPLES 必须在 0 到 20000 之间")
    command = [
        str(bridge),
        "--amos-home", str(amos_home),
        "--input", str(input_path),
        "--sheet", "data",
        "--output", str(bridge_result_path),
        "--raw-output", str(raw_output_path),
        "--bootstrap", str(bootstrap_samples),
        "--seed", str(seed),
    ]
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    completed = subprocess.run(
        command,
        cwd=str(staging_dir),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15 * 60,
        creationflags=creation_flags,
        check=False,
    )
    try:
        input_path.unlink(missing_ok=True)
    except OSError:
        pass
    if completed.returncode != 0:
        combined = "\n".join(part for part in (completed.stderr, completed.stdout) if part).strip()
        last_line = next((line.strip() for line in reversed(combined.splitlines()) if line.strip()), "AMOS Engine 未知错误")
        message = re.sub(r"^AmosBridgeError:\s*", "", last_line)
        raise RuntimeError(f"AMOS 分析失败：{message}")
    if not bridge_result_path.is_file() or not raw_output_path.is_file():
        raise RuntimeError("AMOS 分析返回成功但缺少结构化结果或原始输出")
    amos = json.loads(bridge_result_path.read_text(encoding="utf-8"))
    status = amos.get("status", {})
    if status.get("returnCode") != 0 or not status.get("stable") or not status.get("admissible"):
        raise RuntimeError("AMOS 模型未稳定收敛或返回不可接受解，未生成报告")
    # Do not leak a user's local installation path or retain the staging path
    # that is removed after delivery.  The raw output is delivered beside the
    # JSON under this stable artifact name.
    amos.get("engine", {}).pop("amosHome", None)
    amos["rawOutput"] = "AMOS原始输出.AmosOutput.html"
    bridge_result_path.write_text(json.dumps(amos, ensure_ascii=False, indent=2), encoding="utf-8")
    return amos, [bridge_result_path, raw_output_path]


def append_amos_sections(result: dict[str, Any], amos: dict[str, Any]) -> None:
    tables = result["tables"]
    numbered_count = sum(1 for payload in tables if payload["type"] == "text" and re.match(r"^\d+、", payload["title"]))
    engine = amos["engine"]
    status = amos["status"]
    tables.append(text(
        f"{numbered_count + 1}、验证性因子与结构方程模型（IBM SPSS Amos Engine）",
        f"系统在后台调用本机 IBM SPSS Amos Engine {engine['fileVersion']}，采用最大似然法估计；"
        f"样本量 N={status['sampleSize']}，观测题项 {status['observedVariables']} 个，模型已稳定收敛且解可接受。"
        "本节数值来自 Amos Engine 实际拟合，不是前端演示值；PV 在潜变量 SEM 中作为 AA 的主效应变量，PP×PV 调节仍由前述观测维度得分回归检验。",
    ))

    fit = amos["fit"]
    criteria = {
        "CMIN": ("报告值，无统一通过线", None),
        "DF": ("报告值", None),
        "P": ("卡方 p 易受样本量影响", None),
        "CMIN/DF": ("<3.000", lambda value: value < 3),
        "RMR": ("<0.080", lambda value: value < .08),
        "GFI": (">=0.900", lambda value: value >= .90),
        "AGFI": (">=0.900", lambda value: value >= .90),
        "PGFI": (">=0.500", lambda value: value >= .50),
        "NFI": (">=0.900", lambda value: value >= .90),
        "RFI": (">=0.900", lambda value: value >= .90),
        "IFI": (">=0.900", lambda value: value >= .90),
        "TLI": (">=0.900", lambda value: value >= .90),
        "CFI": (">=0.900", lambda value: value >= .90),
        "RMSEA": ("<=0.080", lambda value: value <= .08),
    }
    fit_rows = []
    for name, (reference, judge) in criteria.items():
        value = fit.get(name)
        if value is None:
            continue
        conclusion = "报告值" if judge is None else ("达到" if judge(float(value)) else "未达到")
        fit_rows.append([name, value, reference, conclusion])
    tables.append(table("AMOS 模型拟合指标", ["指标", "结果", "常用参考", "判断"], fit_rows))
    tables.append(text(
        "拟合度说明",
        "拟合判断综合参考绝对拟合、增值拟合和简约拟合指标，不以单一阈值自动决定模型真伪；"
        "卡方检验对样本量较敏感。本次多数增值、简约及 RMSEA 指标达到表中参考，"
        "但精确拟合卡方 p<0.05，且 GFI/AGFI 未达到 0.900，不能表述为全部指标通过。"
        "表中 RMR 为 Amos 报告的未标准化 RMR，不等同于 SRMR。",
    ))

    loading_rows = []
    structural_rows = []
    for row in amos["parameters"]:
        p_value = row.get("pValue")
        common = [
            row["estimate"],
            "-" if row.get("standardError") is None else row["standardError"],
            "-" if row.get("criticalRatio") is None else row["criticalRatio"],
            "-" if p_value is None else p_fmt(float(p_value)),
            row["standardized"],
        ]
        if row["kind"] == "loading":
            loading_rows.append([row["source"], row["target"], *common])
        else:
            conclusion = "显著" if p_value is not None and float(p_value) < .05 else "不显著"
            structural_rows.append([f"{row['source']}→{row['target']}", *common, conclusion])
    tables.append(table("AMOS 测量模型路径", ["潜变量", "题项", "Estimate", "SE", "C.R.", "p", "标准化Estimate"], loading_rows))
    validity_rows = [
        [row["dimension"], row["ave"], row["compositeReliability"], "达到" if row["ave"] >= .5 and row["compositeReliability"] >= .7 else "未达到"]
        for row in amos["validity"]
    ]
    tables.append(table("聚合效度与组合信度", ["潜变量", "AVE", "CR", "判断"], validity_rows))
    tables.append(table("AMOS 结构路径检验", ["路径", "Estimate", "SE", "C.R.", "p", "标准化Estimate", "结论"], structural_rows))
    r_squared_rows = [[name, value] for name, value in amos.get("rSquared", {}).items() if name in {"PC", "PI", "AA"}]
    tables.append(table("内生潜变量解释率", ["内生变量", "R²"], r_squared_rows))

    effect_rows = []
    for key in ("direct", "viaPC", "viaPI", "totalIndirect", "total"):
        effect = amos["effects"].get(key)
        if not isinstance(effect, dict):
            continue
        bootstrap = effect.get("bootstrap") or {}
        p_value = bootstrap.get("pValue")
        low, high = bootstrap.get("lower95"), bootstrap.get("upper95")
        conclusion = "显著" if bootstrap.get("significant") else ("不显著" if low is not None and high is not None else "未执行Bootstrap")
        effect_rows.append([
            effect["label"], effect["estimate"], "-" if effect.get("standardized") is None else effect["standardized"],
            low, high, "-" if p_value is None else p_fmt(float(p_value)), conclusion,
        ])
    tables.append(table("AMOS Bootstrap 直接、间接与总效应", ["效应", "Estimate", "标准化Estimate", "95%下限", "95%上限", "p", "结论"], effect_rows))
    bootstrap = amos["bootstrap"]
    valid_bootstrap = amos.get("effects", {}).get("validBootstrapSamples", 0)
    tables.append(text(
        "AMOS 结果说明",
        f"Bootstrap 请求 {bootstrap['samplesRequested']} 次、有效 {valid_bootstrap} 次，Amos 随机种子 {bootstrap['amosSeed']}；"
        "两条特定间接效应由每个 Amos Bootstrap 样本的 a×b 路径乘积计算，报告偏差校正百分位 95% 置信区间。"
        "Bootstrap p 为带有限样本校正的双侧经验 p，不会报告精确 0；置信区间不跨 0 判为显著。"
        "所有系数、拟合度和 Bootstrap 样本均来自同一次后台 Amos Engine 运行。",
    ))
    result["raw"]["amos"] = amos


def analyze(frame: pd.DataFrame, plan: dict[str, Any], prompt: str = "", seed: int = 20260712) -> dict[str, Any]:
    plan = validate_plan(plan)
    column_names = [str(column) for column in frame.columns]
    if len(set(column_names)) != len(column_names):
        raise ValueError("输入数据存在重复列名，无法建立唯一题项映射")
    sample_id_column = plan.get("sampleIdColumn")
    if sample_id_column and sample_id_column not in frame.columns:
        raise ValueError("已确认的样本 ID 列不在输入数据中")
    dimensions = plan["dimensions"]
    dim_items = {dim["id"]: item_columns(frame, dim) for dim in dimensions}
    all_items = [item for items in dim_items.values() for item in items]
    raw_items = frame[all_items]
    numeric = raw_items.apply(pd.to_numeric, errors="coerce")
    invalid_numeric = 0
    for column in all_items:
        present = raw_items[column].notna() & raw_items[column].astype(str).str.strip().ne("")
        invalid_numeric += int((present & numeric[column].isna()).sum())
    if invalid_numeric:
        raise ValueError(f"发现 {invalid_numeric} 个非空但无法解析为数值的量表题项单元格")
    scale_min, scale_max = plan["scale"]["min"], plan["scale"]["max"]
    for dim in dimensions:
        for reverse_item in dim.get("reverseItems", []):
            numeric[reverse_item] = scale_min + scale_max - numeric[reverse_item]
    missing = int(sum(frame[column].isna().sum() + frame[column].astype(str).str.strip().eq("").sum() for column in frame.columns))
    out_of_range = int(((numeric < scale_min) | (numeric > scale_max)).sum().sum())
    if out_of_range:
        raise ValueError(f"发现 {out_of_range} 个超出量表范围的值")

    analysis_order = set(plan["analysisOrder"])
    requested = {
        "frequency": "frequency" in analysis_order,
        "descriptive": "item-descriptive" in analysis_order,
        "reliability": "reliability" in analysis_order,
        "efa": "efa" in analysis_order,
        "correlation": "dimension-correlation" in analysis_order,
        "model": "model" in analysis_order,
        "amos": "amos" in analysis_order,
    }
    section_number = 0

    def numbered(title: str) -> str:
        nonlocal section_number
        section_number += 1
        return f"{section_number}、{title}"

    dimension_summary = "；".join(f"{dim['id']}={dim['name']}（{len(dim_items[dim['id']])}题）" for dim in dimensions)
    model = plan["model"]
    if model.get("type") == "parallel-mediation-with-direct-path-moderation":
        model_summary = f"X={model['x']}，Y={model['y']}，并行中介={'+'.join(model['parallelMediators'])}，调节变量={model['moderator']}（调节 {model['moderatedPath']}）"
    elif model.get("y") and (model.get("predictors") or model.get("x")):
        predictors_summary = model.get("predictors") or [model.get("x")]
        model_summary = f"Y={model['y']}，自变量={'+'.join(predictors_summary)}"
    else:
        model_summary = "尚未配置假设检验模型"
    missing_rows = []
    audited_columns = [*all_items, *[demographic["column"] for demographic in plan["demographics"]]]
    for column in dict.fromkeys(audited_columns):
        if column not in frame.columns:
            raise ValueError(f"已确认的分析字段不在数据中：{column}")
        missing_count = int(frame[column].isna().sum() + frame[column].astype(str).str.strip().eq("").sum())
        missing_rate = float(missing_count / len(frame) * 100)
        missing_rows.append([str(column), missing_count, missing_rate, "较高，需确认处理方案" if missing_rate >= 5 else "较低"])
    high_missing = [row[0] for row in missing_rows if row[2] >= 5]
    sections: list[dict[str, Any]] = []
    sections.extend([
        text(numbered("数据质量与变量识别"), f"系统根据列名前缀和分析要求自动识别变量：{dimension_summary}。模型分配为：{model_summary}。共读取 {len(frame)} 份样本、{len(frame.columns)} 个变量，缺失单元格 {missing} 个，量表越界值 {out_of_range} 个。"),
        table("数据基本信息", ["项目", "结果"], [["样本数量", len(frame)], ["变量数量", len(frame.columns)]]),
        table("缺失值分析", ["变量", "缺失数量", "缺失比例(%)", "判断"], missing_rows),
        text("缺失值说明", f"{'以下变量缺失比例达到或超过 5%：' + '、'.join(high_missing) + '，需要结合缺失机制确认删除、插补或保留策略' if high_missing else '各变量缺失比例均低于 5%，整体缺失情况较低；是否插补仍应结合缺失机制和研究设计判断'}。"),
    ])

    if requested["frequency"]:
        freq_rows: list[list[Any]] = []
        for demographic in plan["demographics"]:
            column = demographic["column"]
            if column not in frame.columns:
                raise ValueError(f"人口学变量缺失：{column}")
            counts = frame[column].value_counts(dropna=False).sort_index()
            cumulative = 0.0
            for code, count in counts.items():
                percent = float(count / len(frame) * 100)
                cumulative += percent
                code_key = str(code) if pd.notna(code) else ""
                if isinstance(code, (int, np.integer)):
                    code_key = str(int(code))
                elif isinstance(code, (float, np.floating)) and float(code).is_integer():
                    code_key = str(int(code))
                label = demographic.get("labels", {}).get(code_key, code_key or "缺失")
                freq_rows.append([column, label, int(count), percent, cumulative])
        sections.extend([
        text(numbered("频数分析"), "对样本人口学特征进行频数与构成比统计，结果如下。"),
        table("人口学变量频数分布", ["名称", "选项", "频数", "百分比(%)", "累积百分比(%)"], freq_rows),
        text("结果说明", f"本次仅对操作者显式选择的 {len(plan['demographics'])} 个人口学字段进行统计。各类别构成比均由有效样本数直接计算，累计百分比在每个人口学变量内部重新累计。"),
        ])

    desc_rows = []
    if requested["descriptive"]:
        for column in all_items:
            series = numeric[column].dropna()
            if len(series) < 4:
                raise ValueError(f"描述统计有效样本不足：题项 {column} 至少需要 4 份，实际为 {len(series)} 份")
            desc_rows.append([column.split("_", 1)[0], len(series), series.min(), series.max(), series.mean(), series.std(ddof=1), series.median(), stats.kurtosis(series, bias=False), stats.skew(series, bias=False)])
        sections.extend([
        text(numbered("描述统计"), "对量表题项的集中趋势、离散程度和分布形态进行统计。偏度与峰度均用于判断数据分布是否适合后续参数分析。"),
        table("变量描述及变量分布", ["名称", "样本量", "最小值", "最大值", "平均值", "标准差", "中位数", "峰度", "偏度"], desc_rows),
        text("结果说明", f"{len(desc_rows)} 个量表题项的平均值介于 {min(row[4] for row in desc_rows):.3f}～{max(row[4] for row in desc_rows):.3f}；偏度绝对值最大为 {max(abs(row[8]) for row in desc_rows):.3f}，峰度绝对值最大为 {max(abs(row[7]) for row in desc_rows):.3f}，{'均处于本工具采用的偏度绝对值小于 2、峰度绝对值小于 7 的宽松参数分析参考范围' if max(abs(row[8]) for row in desc_rows) < 2 and max(abs(row[7]) for row in desc_rows) < 7 else '至少一个题项超出本工具采用的偏度绝对值小于 2、峰度绝对值小于 7 的参考范围，应检查异常值并考虑稳健或非参数方法'}。"),
        ])

    reliability_rows = []
    reliability_values: dict[str, float] = {}
    reliability_citcs: list[float] = []
    reliability_sample_sizes: dict[str, int] = {}
    reliability_pass: bool | None = None
    scores = pd.DataFrame(index=frame.index)
    for dim in dimensions:
        dim_id, name = dim["id"], dim["name"]
        values = numeric[dim_items[dim_id]]
        requires_all = plan["scale"].get("missingPolicy") == "dimension-mean-requires-all-items"
        scores[dim_id] = values.mean(axis=1, skipna=not requires_all)
    if requested["reliability"]:
        for dim in dimensions:
            dim_id, name = dim["id"], dim["name"]
            values = numeric[dim_items[dim_id]]
            complete_values = values.dropna()
            reliability_sample_sizes[dim_id] = len(complete_values)
            minimum_reliability_n = max(30, len(values.columns) * 5)
            if len(complete_values) < minimum_reliability_n:
                raise ValueError(f"维度 {dim_id} 的信度有效样本不足：本产品发布门至少需要 {minimum_reliability_n} 份，实际为 {len(complete_values)} 份")
            zero_variance = [column for column in values.columns if complete_values[column].nunique() < 2]
            if zero_variance:
                raise ValueError(f"维度 {dim_id} 有 {len(zero_variance)} 个零方差题项，无法计算可信信度")
            current_alpha = alpha(complete_values)
            if not math.isfinite(current_alpha):
                raise ValueError(f"维度 {dim_id} 的 Cronbach α 无法计算，请检查总分方差和缺失值")
            reliability_values[dim_id] = current_alpha
            for column in dim_items[dim_id]:
                others = complete_values.drop(columns=[column])
                citc = float(complete_values[column].corr(others.sum(axis=1)))
                if not math.isfinite(citc):
                    raise ValueError(f"维度 {dim_id} 的题项总分相关无法计算，请检查零方差或共线数据")
                deletion_alpha = alpha(others) if others.shape[1] >= 2 else None
                reliability_citcs.append(citc)
                reliability_rows.append([name, column.split("_", 1)[0], citc, deletion_alpha, current_alpha])
        reliability_summary = "；".join(f"{dim['name']} α={reliability_values[dim['id']]:.3f}（N={reliability_sample_sizes[dim['id']]}）" for dim in dimensions)
        reliability_pass = all(value >= 0.70 for value in reliability_values.values()) and all(value >= 0.30 for value in reliability_citcs)
        reliability_conclusion = (
            "各维度 Cronbach's α 均不低于 0.70，且各题项 CITC 均不低于 0.30，当前样本的内部一致性达到常用判断标准。"
            if reliability_pass
            else "至少一个维度的 Cronbach's α 低于 0.70，或至少一个题项 CITC 低于 0.30；应结合题项内容和样本特征复核，不能自动判定量表信度良好。"
        )
        sections.extend([
        text(numbered("信度检验"), "采用 Cronbach's α、校正项总计相关性（CITC）和删除题项后的 α 评价各维度内部一致性。"),
        table("信度检验结果", ["维度", "名称", "CITC", "项已删除的α", "Cronbach α"], reliability_rows),
        text("结果说明", f"各维度内部一致性结果为：{reliability_summary}。{reliability_conclusion}"),
        ])

    kmo: float | None = None
    bartlett: float | None = None
    bartlett_p: float | None = None
    efa_sample_size: int | None = None
    efa_suitable: bool | None = None
    if requested["efa"]:
        complete = numeric.dropna()
        n, p = complete.shape
        efa_sample_size = n
        factor_count = len(dimensions)
        minimum_n = max(100, p * 5, p + 1, factor_count + 2)
        if n < minimum_n:
            raise ValueError(f"主成分结构检查完整样本不足：至少需要 {minimum_n} 份，实际为 {n} 份")
        if factor_count >= p:
            raise ValueError("计划提取的主成分数量必须小于题项数量")
        zero_variance = [column for column in complete.columns if complete[column].nunique() < 2]
        if zero_variance:
            raise ValueError(f"主成分结构检查包含 {len(zero_variance)} 个零方差题项")
        corr = complete.corr().to_numpy()
        if not np.isfinite(corr).all() or np.linalg.matrix_rank(corr) < p:
            raise ValueError("题项相关矩阵非有限或奇异，无法执行可信主成分结构检查")
        determinant = float(np.linalg.det(corr))
        if determinant <= 0:
            raise ValueError("题项相关矩阵行列式不为正，无法执行 Bartlett 检验")
        inv = np.linalg.inv(corr)
        partial = -inv / np.sqrt(np.outer(np.diag(inv), np.diag(inv)))
        np.fill_diagonal(partial, 0)
        off = corr.copy(); np.fill_diagonal(off, 0)
        denominator = float(np.sum(off ** 2) + np.sum(partial ** 2))
        if denominator <= 0:
            raise ValueError("题项相关结构不足，无法计算 KMO")
        kmo = float(np.sum(off ** 2) / denominator)
        bartlett = float(-(n - 1 - (2 * p + 5) / 6) * np.log(determinant))
        bartlett_df = int(p * (p - 1) / 2)
        bartlett_p = float(stats.chi2.sf(bartlett, bartlett_df))
        efa_suitable = kmo >= 0.60 and bartlett_p < 0.05
        eigvals, eigvecs = np.linalg.eigh(corr)
        order = np.argsort(eigvals)[::-1]
        eigvals, eigvecs = eigvals[order], eigvecs[:, order]
        if eigvals[factor_count - 1] <= 0:
            raise ValueError("计划提取的主成分数量超过正特征根数量")
        loadings = varimax(eigvecs[:, :factor_count] * np.sqrt(eigvals[:factor_count]))
        variance_rows = []
        cumulative = 0.0
        for index, eigenvalue in enumerate(eigvals):
            pct = float(eigenvalue / p * 100); cumulative += pct
            variance_rows.append([index + 1, eigenvalue, pct, cumulative])
        loading_rows = [[column.split("_", 1)[0], *row] for column, row in zip(all_items, loadings)]
        sections.extend([
        text(numbered("主成分结构检查（PCA+Varimax）"), f"先使用 KMO 与 Bartlett 球形度检验判断结构分析适用性；随后基于题项相关矩阵进行主成分提取，按人工确认的 {factor_count} 个维度固定成分数，再进行 Varimax 正交旋转。本模块不是公因子提取，也不使用平行分析自动决定因子数。"),
        table("KMO 与 Bartlett 检验", ["指标", "值"], [["KMO", kmo], ["Bartlett 近似卡方", bartlett], ["df", bartlett_df], ["p", p_fmt(bartlett_p)]]),
        table("主成分方差解释率", ["成分编号", "特征根", "方差解释率%", "累积%"], variance_rows),
        table("旋转后成分载荷", ["名称", *[f"成分{i+1}" for i in range(factor_count)]], loading_rows),
        text("结果说明", f"KMO={kmo:.3f}，Bartlett 球形度检验 χ²={bartlett:.3f}，df={bartlett_df}，p{p_fmt(bartlett_p)}；{'达到常用结构分析适用性标准' if efa_suitable else '未同时达到 KMO≥0.60 且 Bartlett p<0.05 的常用适用性标准，结果应谨慎解释'}。按确认维度数固定提取的前 {factor_count} 个主成分累计解释 {sum(eigvals[:factor_count]) / p * 100:.3f}% 的总方差。旋转载荷以绝对值判断主载荷，成分正负号仅反映数学方向，不改变结构含义；不得把本结果表述为平行分析选因子或公因子法结果。"),
        ])

    corr_rows = []
    corr_n_rows = []
    correlation_sample_sizes: dict[str, int] = {}
    if requested["correlation"]:
        correlation_cache: dict[tuple[str, str], tuple[float, float, int]] = {}
        for row_name in scores.columns:
            row = [plan_name(dimensions, row_name)]
            n_row = [plan_name(dimensions, row_name)]
            for col_name in scores.columns:
                if row_name == col_name:
                    valid_n = int(scores[row_name].notna().sum())
                    if valid_n < 30:
                        raise ValueError(f"维度 {row_name} 的相关有效样本不足：本产品发布门至少需要 30 份，实际为 {valid_n} 份")
                    row.append("1.000")
                    n_row.append(valid_n)
                    correlation_sample_sizes[f"{row_name}|{col_name}"] = valid_n
                    continue
                cache_key = tuple(sorted((row_name, col_name)))
                if cache_key not in correlation_cache:
                    pair = scores[[row_name, col_name]].dropna()
                    valid_n = len(pair)
                    if valid_n < 30:
                        raise ValueError(f"维度相关有效样本不足：{row_name} 与 {col_name} 的发布门至少需要 30 份，实际为 {valid_n} 份")
                    if pair[row_name].nunique() < 2 or pair[col_name].nunique() < 2:
                        raise ValueError(f"维度相关无法计算：{row_name} 或 {col_name} 在有效样本中为零方差")
                    r, p_value = stats.pearsonr(pair[row_name], pair[col_name])
                    if not math.isfinite(float(r)) or not math.isfinite(float(p_value)):
                        raise ValueError(f"维度相关无法计算：{row_name} 与 {col_name} 返回非有限结果")
                    correlation_cache[cache_key] = (float(r), float(p_value), valid_n)
                r, p_value, valid_n = correlation_cache[cache_key]
                marker = "**" if p_value < .01 else "*" if p_value < .05 else ""
                row.append(f"{r:.3f}{marker}")
                n_row.append(valid_n)
                correlation_sample_sizes[f"{row_name}|{col_name}"] = valid_n
            corr_rows.append(row)
            corr_n_rows.append(n_row)
        sections.extend([
        text(numbered("相关性分析"), "采用各维度题项均值计算 Pearson 相关系数，并按每对变量删除缺失；* p<0.05，** p<0.01。"),
        table("维度相关矩阵", ["变量", *[dim["name"] for dim in dimensions]], corr_rows),
        table("维度相关有效样本量", ["变量", *[dim["name"] for dim in dimensions]], corr_n_rows),
        text("结果说明", "各维度 Pearson 相关系数及显著性标记见上表。相关关系只描述变量共同变化，不等同于因果关系；方向和显著性必须以本次表中实际数值为准。"),
        ])

    def validate_regression_data(model_data: pd.DataFrame, outcome: str, predictors: list[str], label: str) -> None:
        minimum_n = max(30, (len(predictors) + 1) * 10)
        if len(model_data) < minimum_n:
            raise ValueError(f"{label}完整样本不足：至少需要 {minimum_n} 份，实际为 {len(model_data)} 份")
        if model_data[outcome].nunique() < 2:
            raise ValueError(f"{label}因变量为零方差，无法估计模型")
        zero_variance = [name for name in predictors if model_data[name].nunique() < 2]
        if zero_variance:
            raise ValueError(f"{label}包含 {len(zero_variance)} 个零方差预测变量")
        design = np.column_stack([np.ones(len(model_data)), model_data[predictors].to_numpy(dtype=float)])
        if np.linalg.matrix_rank(design) < design.shape[1]:
            raise ValueError(f"{label}设计矩阵不满秩，预测变量存在完全共线")

    if requested["reliability"] and requested["efa"]:
        measurement_summary = (
            "内部一致性与主成分结构检查适用性均达到本工具采用的常用判断标准"
            if reliability_pass is True and efa_suitable is True
            else "内部一致性或主成分结构检查适用性至少一项未达到本工具采用的常用判断标准，需要人工复核"
        )
    elif requested["reliability"]:
        measurement_summary = "本方案仅执行信度检验，未执行主成分结构检查"
    elif requested["efa"]:
        measurement_summary = "本方案仅执行主成分结构检查，未执行信度检验"
    else:
        measurement_summary = "本方案未执行信度或主成分结构检查，不对测量质量作自动结论"

    advanced_model = model.get("type") == "parallel-mediation-with-direct-path-moderation"
    if not advanced_model or not requested["model"]:
        regression_raw: dict[str, Any] | None = None
        regression_sample_size: int | None = None
        if requested["model"]:
            y = model.get("y")
            predictors = list(dict.fromkeys(model.get("predictors") or ([model.get("x")] if model.get("x") else [])))
            if not y or not predictors:
                raise ValueError("需要执行回归或假设检验，但未识别到模型角色；请在分析要求中写明“X为自变量、Y为因变量”")
            if y in predictors:
                raise ValueError("因变量不能同时作为回归自变量")
            model_data = scores[[y, *predictors]].dropna()
            validate_regression_data(model_data, y, predictors, "回归分析")
            regression_sample_size = len(model_data)
            regression = ols(model_data[y], model_data[predictors])
            coefficient_rows = []
            significant: list[str] = []
            for name in ["const", *predictors]:
                p_value = float(regression.pvalues[name])
                if name == "const":
                    beta, vif = "-", "-"
                    label = "常数"
                else:
                    beta = float(regression.params[name] * model_data[name].std(ddof=1) / model_data[y].std(ddof=1))
                    label = plan_name(dimensions, name)
                    if len(predictors) == 1:
                        vif = 1.0
                    else:
                        other_predictors = [value for value in predictors if value != name]
                        auxiliary = ols(model_data[name], model_data[other_predictors])
                        vif = float("inf") if auxiliary.rsquared >= 1 else 1 / (1 - auxiliary.rsquared)
                    if p_value < .05:
                        significant.append(f"{label}（β={beta:.3f}，p{p_fmt(p_value)}）")
                coefficient_rows.append([label, regression.params[name], beta, regression.bse[name], regression.tvalues[name], p_fmt(p_value), vif])
            model_summary = f"Y={y}，自变量={'+'.join(predictors)}"
            sections.extend([
                text(numbered("多元回归与假设检验"), f"以{plan_name(dimensions, y)}为因变量，以{'、'.join(plan_name(dimensions, value) for value in predictors)}为自变量进行普通最小二乘回归。"),
                table("模型摘要", ["样本量", "R²", "调整R²", "F", "df1", "df2", "p"], [[regression.nobs, regression.rsquared, regression.rsquared_adj, regression.fvalue, regression.df_model, regression.df_resid, p_fmt(regression.f_pvalue)]]),
                table("回归系数", ["变量", "B", "标准化β", "标准误", "t", "p", "VIF"], coefficient_rows),
                text("回归结果说明", f"模型 R²={regression.rsquared:.3f}，调整 R²={regression.rsquared_adj:.3f}，F={regression.fvalue:.3f}，p{p_fmt(regression.f_pvalue)}。{'达到 0.05 显著性水平的自变量包括：' + '、'.join(significant) if significant else '没有自变量达到 0.05 显著性水平'}；结论以本次系数方向、p 值及研究设计为准，不能仅凭显著性作因果推断。"),
                text(numbered("综合结论"), f"本次共分析 {len(frame)} 份样本，缺失单元格 {missing} 个、量表越界值 {out_of_range} 个；{measurement_summary}。回归模型与系数表给出了研究假设的统计证据，正式论文仍需结合理论和抽样边界解释。"),
            ])
            regression_raw = {
                "predictors": predictors,
                "outcome": y,
                "coefficients": regression.params.to_dict(),
                "rSquared": regression.rsquared,
                "adjustedRSquared": regression.rsquared_adj,
                "f": regression.fvalue,
                "p": regression.f_pvalue,
            }
        analysis_scope = ["data-quality", *[name for name, enabled in requested.items() if enabled]]
        raw: dict[str, Any] = {
            "planSummary": model_summary,
            "analysisScope": analysis_scope,
            "seed": seed,
            "dataQuality": {
                "sampleSize": len(frame),
                "variableCount": len(frame.columns),
                "missingCells": missing,
                "outOfRangeCells": out_of_range,
            },
            "effectiveSampleSizes": {
                "reliabilityByDimension": reliability_sample_sizes,
                "efa": efa_sample_size,
                "correlationByPair": correlation_sample_sizes,
                "regression": regression_sample_size,
            },
        }
        if requested["reliability"]:
            raw["reliability"] = reliability_values
        if requested["efa"]:
            raw.update({
                "kmo": kmo,
                "bartlett": bartlett,
                "bartlettP": bartlett_p,
                "efaMethod": {
                    "extraction": "principal-components-from-correlation-matrix",
                    "rotation": "varimax",
                    "factorCount": len(dimensions),
                    "factorCountSource": "confirmed-dimension-count",
                    "commonFactorModel": False,
                    "dataDrivenFactorCount": False,
                },
            })
        if regression_raw is not None:
            raw["regression"] = regression_raw
        return {
            "methodId": "scientific-questionnaire",
            "methodName": f"{plan['title']}数据分析报告",
            "timestamp": int(time.time() * 1000),
            "tables": sections,
            "raw": raw,
        }

    x, y, mediators, moderator = model["x"], model["y"], model["parallelMediators"], model["moderator"]
    model_data = scores[[x, y, *mediators, moderator]].dropna().copy()
    for mediator in mediators:
        validate_regression_data(model_data[[mediator, x]], mediator, [x], f"中介变量 {mediator} 回归")
    model_data[f"{x}_c"] = model_data[x] - model_data[x].mean()
    model_data[f"{moderator}_c"] = model_data[moderator] - model_data[moderator].mean()
    model_data["interaction"] = model_data[f"{x}_c"] * model_data[f"{moderator}_c"]
    mediator_models = {m: ols(model_data[m], model_data[[x]]) for m in mediators}
    predictors = [f"{x}_c", *mediators, f"{moderator}_c", "interaction"]
    validate_regression_data(model_data[[y, *predictors]], y, predictors, "并行中介与调节结果变量回归")
    outcome_model = ols(model_data[y], model_data[predictors])
    mediator_rows = []
    for mediator in mediators:
        mediator_model = mediator_models[mediator]
        mediator_rows.append([mediator, "常数", mediator_model.params["const"], mediator_model.bse["const"], mediator_model.tvalues["const"], p_fmt(float(mediator_model.pvalues["const"])), mediator_model.rsquared])
        mediator_rows.append([mediator, x, mediator_model.params[x], mediator_model.bse[x], mediator_model.tvalues[x], p_fmt(float(mediator_model.pvalues[x])), mediator_model.rsquared])
    regression_rows = []
    for name in ["const", *predictors]:
        regression_rows.append(["常数" if name == "const" else name, outcome_model.params[name], outcome_model.bse[name], outcome_model.tvalues[name], p_fmt(float(outcome_model.pvalues[name]))])

    rng = np.random.default_rng(seed)
    indirect_samples = {m: [] for m in mediators}
    bootstrap_values = model_data[[x, y, *mediators, moderator, f"{x}_c", f"{moderator}_c", "interaction"]].to_numpy(dtype=float)
    column_index = {name: index for index, name in enumerate([x, y, *mediators, moderator, f"{x}_c", f"{moderator}_c", "interaction"])}
    for _ in range(model["bootstrapSamples"]):
        sample = bootstrap_values[rng.integers(0, len(bootstrap_values), len(bootstrap_values))]
        outcome_x = np.column_stack([
            np.ones(len(sample)),
            sample[:, column_index[f"{x}_c"]],
            *[sample[:, column_index[m]] for m in mediators],
            sample[:, column_index[f"{moderator}_c"]],
            sample[:, column_index["interaction"]],
        ])
        outcome_beta = np.linalg.lstsq(outcome_x, sample[:, column_index[y]], rcond=None)[0]
        for mediator_offset, mediator in enumerate(mediators, start=2):
            mediator_x = np.column_stack([np.ones(len(sample)), sample[:, column_index[x]]])
            a = np.linalg.lstsq(mediator_x, sample[:, column_index[mediator]], rcond=None)[0][1]
            indirect_samples[mediator].append(float(a * outcome_beta[mediator_offset]))
    indirect_rows = []
    for mediator in mediators:
        a = mediator_models[mediator].params[x]
        b = outcome_model.params[mediator]
        effect = float(a * b)
        low, high = np.quantile(indirect_samples[mediator], [0.025, 0.975])
        indirect_rows.append([f"{x}→{mediator}→{y}", effect, low, high, "显著" if low * high > 0 else "不显著"])
    total_samples = np.sum(np.column_stack([indirect_samples[m] for m in mediators]), axis=1)
    total_effect = sum(float(mediator_models[m].params[x] * outcome_model.params[m]) for m in mediators)
    total_low, total_high = np.quantile(total_samples, [0.025, 0.975])
    indirect_rows.append(["总间接效应", total_effect, total_low, total_high, "显著" if total_low * total_high > 0 else "不显著"])

    mod_sd = float(model_data[moderator].std(ddof=1))
    cov = outcome_model.cov_params()
    slope_rows = []
    for label, centered_w in [("低水平(-1SD)", -mod_sd), ("平均水平", 0.0), ("高水平(+1SD)", mod_sd)]:
        slope = outcome_model.params[f"{x}_c"] + centered_w * outcome_model.params["interaction"]
        variance = cov.loc[f"{x}_c", f"{x}_c"] + centered_w**2 * cov.loc["interaction", "interaction"] + 2 * centered_w * cov.loc[f"{x}_c", "interaction"]
        se = math.sqrt(max(float(variance), 0)); t_value = float(slope / se); p_value = float(2 * stats.t.sf(abs(t_value), outcome_model.df_resid))
        slope_rows.append([label, slope, se, t_value, p_fmt(p_value)])
    interaction_p = float(outcome_model.pvalues["interaction"])
    indirect_description = "；".join(f"{row[0]}={row[1]:.3f}，95%CI[{row[2]:.3f}, {row[3]:.3f}]，{row[4]}" for row in indirect_rows)
    significant_indirect = [row[0] for row in indirect_rows if row[4] == "显著"]
    mediation_conclusion = f"显著间接效应包括：{'、'.join(significant_indirect)}" if significant_indirect else "各特定间接效应及总间接效应的置信区间均跨 0，未获得显著中介证据"
    moderation_conclusion = ("交互项达到 0.05 显著性水平，本样本支持 PV 调节 PP→AA 直接路径" if interaction_p < .05 else "交互项未达到 0.05 显著性水平，本样本未支持 PV 调节 PP→AA 直接路径")
    measurement_conclusion = measurement_summary
    if requested["model"]:
        sections.extend([
        text(numbered("并行中介与调节作用"), "PC 与 PI 作为并行中介；PV 调节 PP→AA 的直接路径。连续变量均值中心化，间接效应采用 5000 次 Bootstrap。"),
        table("中介变量回归模型", ["结果变量", "预测变量", "B", "标准误", "t", "p", "R²"], mediator_rows),
        text("中介路径说明", "中介变量模型用于估计 PP→PC 与 PP→PI 的 a 路径；间接效应的显著性以 Bootstrap 置信区间是否跨 0 为准。"),
        table("结果变量模型汇总", ["样本量", "R²", "调整R²", "F", "df1", "df2", "p"], [[outcome_model.nobs, outcome_model.rsquared, outcome_model.rsquared_adj, outcome_model.fvalue, outcome_model.df_model, outcome_model.df_resid, p_fmt(outcome_model.f_pvalue)]]),
        table("结果变量回归模型", ["变量", "B", "标准误", "t", "p"], regression_rows),
        table("Bootstrap 并行中介效应", ["中介路径", "间接效应", "95%下限", "95%上限", "结论"], indirect_rows),
        text("中介效应说明", indirect_description + "。"),
        table("PV 不同水平下 PP→AA 简单斜率", ["PV水平", "条件直接效应", "标准误", "t", "p"], slope_rows),
        text("调节效应说明", f"PP×PV 交互项 B={outcome_model.params['interaction']:.3f}，p={p_fmt(interaction_p)}。{moderation_conclusion}；简单斜率用于展示各调节水平下的条件直接效应。"),
        text(numbered("综合结论"), f"本次共分析 {len(frame)} 份样本，缺失单元格 {missing} 个、量表越界值 {out_of_range} 个；{measurement_conclusion}。并行中介 Bootstrap 区间与交互项检验应作为模型判断依据；{mediation_conclusion}；{moderation_conclusion}。以上结论仅针对当前样本与模型设定，不作超出研究设计的因果外推。"),
        ])

    x_sd = float(model_data[x].std(ddof=1))
    x_grid = np.linspace(-x_sd, x_sd, 30)
    plot_lines = {}
    mediator_means = {m: float(model_data[m].mean()) for m in mediators}
    for label, centered_w in [("PV低水平(-1SD)", -mod_sd), ("PV平均水平", 0.0), ("PV高水平(+1SD)", mod_sd)]:
        predicted = outcome_model.params["const"] + outcome_model.params[f"{x}_c"] * x_grid + sum(outcome_model.params[m] * mediator_means[m] for m in mediators) + outcome_model.params[f"{moderator}_c"] * centered_w + outcome_model.params["interaction"] * x_grid * centered_w
        plot_lines[label] = predicted.tolist()
    analysis_scope = ["data-quality", *[name for name, enabled in requested.items() if enabled]]
    raw: dict[str, Any] = {
        "planSummary": model_summary,
        "analysisScope": analysis_scope,
        "seed": seed,
        "dataQuality": {
            "sampleSize": len(frame),
            "variableCount": len(frame.columns),
            "missingCells": missing,
            "outOfRangeCells": out_of_range,
        },
        "effectiveSampleSizes": {
            "reliabilityByDimension": reliability_sample_sizes,
            "efa": efa_sample_size,
            "correlationByPair": correlation_sample_sizes,
            "advancedModel": len(model_data),
        },
    }
    if requested["reliability"]:
        raw["reliability"] = reliability_values
    if requested["efa"]:
        raw.update({
            "kmo": kmo,
            "bartlett": bartlett,
            "bartlettP": bartlett_p,
            "efaMethod": {
                "extraction": "principal-components-from-correlation-matrix",
                "rotation": "varimax",
                "factorCount": len(dimensions),
                "factorCountSource": "confirmed-dimension-count",
                "commonFactorModel": False,
                "dataDrivenFactorCount": False,
            },
        })
    if requested["model"]:
        raw.update({
            "bootstrapSamples": model["bootstrapSamples"],
            "mediatorModels": {m: mediator_models[m].params.to_dict() for m in mediators},
            "outcomeModel": outcome_model.params.to_dict(),
            "outcomeModelStats": {
                "rSquared": outcome_model.rsquared,
                "adjustedRSquared": outcome_model.rsquared_adj,
                "f": outcome_model.fvalue,
                "p": outcome_model.f_pvalue,
            },
            "indirect": indirect_rows,
            "slopes": slope_rows,
            "moderationPlot": {"x": x_grid.tolist(), "lines": plot_lines},
        })
    return {
        "methodId": "scientific-questionnaire",
        "methodName": f"{plan['title']}数据分析报告",
        "timestamp": int(time.time() * 1000),
        "tables": sections,
        "raw": raw,
    }


def plan_name(dimensions: list[dict[str, Any]], dim_id: str) -> str:
    return next(dim["name"] for dim in dimensions if dim["id"] == dim_id)


def set_cell_text(cell, value: Any, bold: bool = False, font_size: float = 9) -> None:
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run(str(value))
    run.bold = bold; run.font.size = Pt(font_size); run.font.name = "Times New Roman"; run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def set_repeat_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def prevent_row_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tr_pr.append(OxmlElement("w:cantSplit"))


def set_table_layout_fixed(table_obj) -> None:
    tbl_pr = table_obj._tbl.tblPr
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")


def set_cell_width(cell, width_cm: float) -> None:
    cell.width = Cm(width_cm)
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(width_cm * 567)))
    tc_w.set(qn("w:type"), "dxa")


def column_widths(headers: list[str]) -> list[float]:
    total = 17.4
    if headers == ["名称", "选项", "频数", "百分比(%)", "累积百分比(%)"]:
        return [2.2, 5.0, 2.0, 3.4, 4.8]
    if len(headers) == 9:
        return [1.7, 1.7, 1.7, 1.7, 2.1, 2.1, 2.1, 2.1, 2.2]
    if headers[:2] == ["维度", "名称"]:
        return [3.1, 2.2, 2.4, 4.5, 5.2]
    return [total / len(headers)] * len(headers)


def set_border(table_obj, edge: str, size: str = "12") -> None:
    tbl_pr = table_obj._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders"); tbl_pr.append(borders)
    element = borders.find(qn(f"w:{edge}"))
    if element is None:
        element = OxmlElement(f"w:{edge}"); borders.append(element)
    element.set(qn("w:val"), "single"); element.set(qn("w:sz"), size); element.set(qn("w:color"), "000000")


def add_docx_table(document: Document, payload: dict[str, Any]) -> None:
    rows = payload["rows"]; headers = payload["headers"]
    font_size = 7.5 if len(headers) >= 8 else 8.5 if len(headers) >= 6 else 9
    widths = column_widths(headers)
    doc_table = document.add_table(rows=1, cols=len(headers)); doc_table.alignment = WD_TABLE_ALIGNMENT.CENTER; doc_table.autofit = False
    set_table_layout_fixed(doc_table)
    for index, header in enumerate(headers):
        set_cell_text(doc_table.rows[0].cells[index], header, True, font_size)
        set_cell_width(doc_table.rows[0].cells[index], widths[index])
    set_repeat_header(doc_table.rows[0])
    for row in rows:
        cells = doc_table.add_row().cells
        for index, value in enumerate(row):
            set_cell_text(cells[index], value, False, font_size)
            set_cell_width(cells[index], widths[index])
    for row in doc_table.rows:
        prevent_row_split(row)
    set_border(doc_table, "top", "16"); set_border(doc_table, "bottom", "16")
    for cell in doc_table.rows[0].cells:
        tc_pr = cell._tc.get_or_add_tcPr(); tc_borders = OxmlElement("w:tcBorders"); edge = OxmlElement("w:bottom"); edge.set(qn("w:val"), "single"); edge.set(qn("w:sz"), "8"); edge.set(qn("w:color"), "000000"); tc_borders.append(edge); tc_pr.append(tc_borders)
    if len(rows) <= 8:
        for row in doc_table.rows[:-1]:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.keep_with_next = True
    document.add_paragraph()


def configure_matplotlib_font() -> None:
    regular_path = bundled_font_dir() / "NotoSansSC-Regular.ttf"
    if not regular_path.is_file():
        raise RuntimeError(f"内置中文字体缺失，请重新安装或重新解压完整程序：{regular_path}")
    try:
        font_manager.fontManager.addfont(str(regular_path))
        family = font_manager.FontProperties(fname=str(regular_path)).get_name()
    except Exception as error:
        raise RuntimeError(f"内置中文字体损坏或无法加载：{error}") from error
    plt.rcParams["font.sans-serif"] = [family]


def create_model_figure(output: Path) -> Path:
    configure_matplotlib_font()
    plt.rcParams["axes.unicode_minus"] = False
    figure, axis = plt.subplots(figsize=(8.4, 3.4))
    axis.set_xlim(0, 1); axis.set_ylim(0, 1); axis.axis("off")
    nodes = {
        "PP\n感知个性化": (0.08, 0.50),
        "PC\n隐私担忧": (0.42, 0.76),
        "PI\n感知侵扰": (0.42, 0.24),
        "AA\n广告回避": (0.82, 0.50),
        "PV\n广告感知价值": (0.54, 0.96),
    }
    for label, (x, y) in nodes.items():
        axis.text(x, y, label, ha="center", va="center", fontsize=11,
                  bbox=dict(boxstyle="round,pad=0.45", facecolor="white", edgecolor="black", linewidth=1.1))
    def arrow(start, end, dashed=False):
        axis.annotate("", xy=end, xytext=start, arrowprops=dict(arrowstyle="->", lw=1.2, linestyle="--" if dashed else "-", color="black"))
    arrow((0.15, .55), (.35, .72)); arrow((.49, .72), (.75, .55))
    arrow((0.15, .45), (.35, .28)); arrow((.49, .28), (.75, .45))
    arrow((.16, .50), (.74, .50)); arrow((.54, .88), (.54, .56), True)
    axis.text(.47, .53, "直接路径", fontsize=9, ha="center", va="bottom")
    axis.text(.58, .71, "调节 PP→AA", fontsize=9, ha="left")
    figure.tight_layout()
    path = output / "研究模型图.png"
    figure.savefig(path, dpi=220, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    return path


def create_moderation_figure(result: dict[str, Any], output: Path) -> Path:
    payload = result["raw"]["moderationPlot"]
    configure_matplotlib_font()
    plt.rcParams["axes.unicode_minus"] = False
    figure, axis = plt.subplots(figsize=(7.2, 4.1))
    for label, values in payload["lines"].items():
        axis.plot(payload["x"], values, linewidth=1.8, label=label)
    axis.axvline(0, color="#999999", linewidth=.7, linestyle=":")
    axis.set_xlabel("中心化后的感知个性化（PP）")
    axis.set_ylabel("广告回避（AA）预测值")
    axis.legend(frameon=False, fontsize=9)
    axis.grid(axis="y", alpha=.18)
    figure.tight_layout()
    path = output / "调节效应图.png"
    figure.savefig(path, dpi=220, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    return path


def create_amos_model_figure(result: dict[str, Any], output: Path) -> Path:
    amos = result.get("raw", {}).get("amos")
    if not isinstance(amos, dict):
        raise RuntimeError("AMOS 模型图缺少结构化结果")
    configure_matplotlib_font()
    plt.rcParams["axes.unicode_minus"] = False
    figure, axis = plt.subplots(figsize=(11.5, 6.8))
    axis.set_xlim(0, 1); axis.set_ylim(0, 1); axis.axis("off")
    latent_positions = {
        "PP": (.16, .63), "PV": (.16, .24), "PC": (.46, .78), "PI": (.46, .34), "AA": (.77, .56),
    }
    names = {"PP": "感知个性化", "PV": "广告感知价值", "PC": "隐私担忧", "PI": "感知侵扰", "AA": "广告回避"}
    for latent, (x, y) in latent_positions.items():
        axis.add_patch(Ellipse((x, y), .145, .075, facecolor="#EFF6FF", edgecolor="#1D4ED8", linewidth=1.25, zorder=3))
        axis.text(x, y, f"{latent}\n{names[latent]}", ha="center", va="center", fontsize=8.4, zorder=4)

    indicators = {
        "PP": [(f"PP{i}", (.045, .90 - (i - 1) * .09), (.012, .90 - (i - 1) * .09)) for i in range(1, 5)],
        "PV": [(f"PV{i}", (.045, .43 - (i - 1) * .09), (.012, .43 - (i - 1) * .09)) for i in range(1, 5)],
        "PC": [(f"PC{i}", (.32 + (i - 1) * .095, .94), (.32 + (i - 1) * .095, .985)) for i in range(1, 5)],
        "PI": [(f"PI{i}", (.28 + (i - 1) * .09, .075), (.28 + (i - 1) * .09, .022)) for i in range(1, 6)],
        "AA": [(f"AA{i}", (.925, .70 - (i - 1) * .14), (.978, .70 - (i - 1) * .14)) for i in range(1, 4)],
    }
    standardized = {(row["target"], row["source"]): row.get("standardized") for row in amos.get("parameters", [])}
    for latent, items in indicators.items():
        lx, ly = latent_positions[latent]
        for item, (x, y), (ex, ey) in items:
            axis.add_patch(Rectangle((x - .031, y - .021), .062, .042, facecolor="white", edgecolor="#374151", linewidth=.9, zorder=3))
            axis.text(x, y, item, ha="center", va="center", fontsize=7.1, zorder=4)
            axis.add_patch(Circle((ex, ey), .012, facecolor="#F3F4F6", edgecolor="#6B7280", linewidth=.75, zorder=3))
            axis.text(ex, ey, "e", ha="center", va="center", fontsize=5.5, color="#4B5563", zorder=4)
            axis.add_patch(FancyArrowPatch((lx, ly), (x, y), arrowstyle="-|>", mutation_scale=8, linewidth=.75, color="#6B7280", zorder=1))
            axis.add_patch(FancyArrowPatch((ex, ey), (x, y), arrowstyle="-|>", mutation_scale=7, linewidth=.65, color="#9CA3AF", zorder=1))
            loading = standardized.get((item, latent))
            if loading is not None:
                mx, my = lx * .58 + x * .42, ly * .58 + y * .42
                axis.text(mx, my, f"{float(loading):.2f}", fontsize=6.2, color="#374151", ha="center", va="center", zorder=5,
                          bbox=dict(boxstyle="round,pad=.08", facecolor="white", edgecolor="none", alpha=.8))

    structural_edges = [("PP", "PC"), ("PP", "PI"), ("PP", "AA"), ("PC", "AA"), ("PI", "AA"), ("PV", "AA")]
    for source, target in structural_edges:
        start, end = latent_positions[source], latent_positions[target]
        axis.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>", mutation_scale=12, linewidth=1.35, color="#111827",
                                       connectionstyle="arc3,rad=.05", zorder=2))
        coefficient = standardized.get((target, source))
        if coefficient is not None:
            mx, my = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2
            axis.text(mx, my + .015, f"β={float(coefficient):.3f}", fontsize=7.4, ha="center", va="center", zorder=6,
                      bbox=dict(boxstyle="round,pad=.15", facecolor="white", edgecolor="#D1D5DB", alpha=.94))
    axis.add_patch(FancyArrowPatch((.12, .60), (.12, .28), arrowstyle="<->", mutation_scale=10, linewidth=1.0,
                                   color="#4B5563", connectionstyle="arc3,rad=.35", zorder=2))
    axis.text(.075, .445, "协方差", fontsize=6.7, rotation=90, ha="center", va="center", color="#4B5563")
    figure.tight_layout(pad=.4)
    path = output / "AMOS结构方程模型图.png"
    figure.savefig(path, dpi=240, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    return path


def add_centered_figure(document: Document, image_path: Path, caption: str, width: float = 13.8) -> None:
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.add_run().add_picture(str(image_path), width=Cm(width))
    caption_p = document.add_paragraph(caption)
    caption_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption_p.paragraph_format.keep_with_next = False
    for run in caption_p.runs:
        run.font.size = Pt(9); run.font.name = "Times New Roman"; run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")


def create_docx(result: dict[str, Any], output: Path) -> None:
    document = Document()
    section = document.sections[0]; section.page_width = Cm(21); section.page_height = Cm(29.7); section.top_margin = Cm(1.8); section.bottom_margin = Cm(1.8); section.left_margin = Cm(1.8); section.right_margin = Cm(1.8)
    styles = document.styles
    normal = styles["Normal"]; normal.font.name = "Times New Roman"; normal._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体"); normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(5); normal.paragraph_format.line_spacing = 1.5
    title = document.add_paragraph(); title.alignment = WD_ALIGN_PARAGRAPH.CENTER; run = title.add_run(result["methodName"]); run.bold = True; run.font.size = Pt(18); run.font.name = "黑体"; run._element.rPr.rFonts.set(qn("w:eastAsia"), "黑体")
    has_model_section = any("并行中介与调节作用" in payload["title"] for payload in result["tables"])
    has_moderation_table = any(payload["title"].startswith("PV 不同水平") for payload in result["tables"])
    model_figure = create_model_figure(output.parent) if has_model_section else None
    moderation_figure = create_moderation_figure(result, output.parent) if has_moderation_table else None
    amos_figure = create_amos_model_figure(result, output.parent) if isinstance(result.get("raw", {}).get("amos"), dict) else None
    for payload in result["tables"]:
        is_section = payload["type"] == "text" and payload["title"][:1].isdigit()
        heading = document.add_paragraph(); heading.paragraph_format.keep_with_next = True
        run = heading.add_run(payload["title"]); run.bold = True; run.font.size = Pt(14 if is_section else 11); run.font.name = "黑体"; run._element.rPr.rFonts.set(qn("w:eastAsia"), "黑体")
        if payload["type"] == "text":
            for row in payload["rows"]:
                paragraph = document.add_paragraph(str(row[0])); paragraph.paragraph_format.first_line_indent = Cm(0.74); paragraph.paragraph_format.line_spacing = 1.5
            if "并行中介与调节作用" in payload["title"] and model_figure is not None:
                add_centered_figure(document, model_figure, "图1  并行中介与直接路径调节模型")
            if "验证性因子与结构方程模型" in payload["title"] and amos_figure is not None:
                add_centered_figure(document, amos_figure, "图3  Amos 测量模型与结构路径（标准化估计）", width=16.2)
        else:
            add_docx_table(document, payload)
            if payload["title"].startswith("PV 不同水平") and moderation_figure is not None:
                add_centered_figure(document, moderation_figure, "图2  PV 不同水平下 PP→AA 条件效应")
    document.save(output)


def bundled_font_dir() -> Path:
    configured = os.environ.get("ANALYZER_FONT_DIR")
    if configured:
        return Path(configured).resolve()
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root:
        return Path(frozen_root) / "assets" / "fonts"
    return Path(__file__).resolve().parents[1] / "assets" / "fonts"


def register_pdf_fonts() -> tuple[str, str]:
    regular_name = "AnalyzerNotoSansSC"
    bold_name = "AnalyzerNotoSansSC-Bold"
    if regular_name in pdfmetrics.getRegisteredFontNames() and bold_name in pdfmetrics.getRegisteredFontNames():
        return regular_name, bold_name
    font_dir = bundled_font_dir()
    regular_path = font_dir / "NotoSansSC-Regular.ttf"
    bold_path = font_dir / "NotoSansSC-Bold.ttf"
    missing = [str(path) for path in (regular_path, bold_path) if not path.is_file()]
    if missing:
        raise RuntimeError(f"内置中文字体缺失，请重新安装或重新解压完整程序：{', '.join(missing)}")
    try:
        pdfmetrics.registerFont(TTFont(regular_name, str(regular_path)))
        pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
        pdfmetrics.registerFontFamily(
            "AnalyzerNotoSansSC",
            normal=regular_name,
            bold=bold_name,
            italic=regular_name,
            boldItalic=bold_name,
        )
    except Exception as error:
        raise RuntimeError(f"内置中文字体损坏或无法加载：{error}") from error
    return regular_name, bold_name


def pdf_paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    content = escape(str(value)).replace("\n", "<br/>")
    return Paragraph(content, style)


def pdf_figure(image_path: Path, caption: str, body_style: ParagraphStyle) -> KeepTogether:
    image = PdfImage(str(image_path))
    target_width = 13.8 * cm
    target_height = target_width * image.imageHeight / image.imageWidth
    max_height = 7.2 * cm
    if target_height > max_height:
        target_width *= max_height / target_height
        target_height = max_height
    image.drawWidth = target_width
    image.drawHeight = target_height
    caption_style = ParagraphStyle(
        "PdfFigureCaption",
        parent=body_style,
        alignment=TA_CENTER,
        fontSize=8.5,
        leading=11,
        spaceBefore=3,
        spaceAfter=7,
    )
    return KeepTogether([image, pdf_paragraph(caption, caption_style)])


def create_pdf(result: dict[str, Any], output: Path) -> None:
    regular_font, bold_font = register_pdf_fonts()
    temp_output = output.with_name(f"{output.stem}.tmp.pdf")
    if temp_output.exists():
        temp_output.unlink()

    body = ParagraphStyle(
        "PdfBody",
        fontName=regular_font,
        fontSize=11,
        leading=16.5,
        alignment=TA_LEFT,
        firstLineIndent=0.74 * cm,
        spaceAfter=5,
        wordWrap="CJK",
        textColor=colors.black,
    )
    title_style = ParagraphStyle(
        "PdfTitle",
        parent=body,
        fontName=bold_font,
        fontSize=18,
        leading=24,
        alignment=TA_CENTER,
        firstLineIndent=0,
        spaceAfter=14,
    )
    section_style = ParagraphStyle(
        "PdfSection",
        parent=body,
        fontName=bold_font,
        fontSize=13,
        leading=18,
        firstLineIndent=0,
        spaceBefore=8,
        spaceAfter=5,
        keepWithNext=True,
    )
    subheading_style = ParagraphStyle(
        "PdfSubheading",
        parent=body,
        fontName=bold_font,
        fontSize=10,
        leading=14,
        firstLineIndent=0,
        spaceBefore=5,
        spaceAfter=4,
        keepWithNext=True,
    )

    doc = BaseDocTemplate(
        str(temp_output),
        pagesize=A4,
        leftMargin=1.8 * cm,
        rightMargin=1.8 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title=result["methodName"],
        author="AI Data Analyzer",
        creator="AI Data Analyzer scientific runtime",
        subject="Synthetic questionnaire analysis report",
    )
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )

    def draw_page(canvas, template_doc) -> None:
        canvas.saveState()
        canvas.setFont(regular_font, 7.5)
        canvas.setFillColor(colors.HexColor("#666666"))
        if template_doc.page > 1:
            canvas.drawString(doc.leftMargin, A4[1] - 1.15 * cm, "AI 数据分析器 - 固定问卷科学报告")
        canvas.drawCentredString(A4[0] / 2, 0.85 * cm, f"第 {template_doc.page} 页")
        canvas.restoreState()

    doc.addPageTemplates(PageTemplate(id="Report", frames=[frame], onPage=draw_page))

    story: list[Any] = [pdf_paragraph(result["methodName"], title_style)]
    model_figure = output.parent / "研究模型图.png"
    moderation_figure = output.parent / "调节效应图.png"
    amos_figure = output.parent / "AMOS结构方程模型图.png"
    for payload in result["tables"]:
        is_section = payload["type"] == "text" and payload["title"][:1].isdigit()
        if is_section and (payload["title"].startswith("5、") or "验证性因子与结构方程模型" in payload["title"]):
            story.append(PageBreak())
        heading_style = section_style if is_section else subheading_style
        story.append(pdf_paragraph(payload["title"], heading_style))
        if payload["type"] == "text":
            for row in payload["rows"]:
                story.append(pdf_paragraph(row[0], body))
            if "并行中介与调节作用" in payload["title"] and model_figure.is_file():
                story.append(pdf_figure(model_figure, "图1  并行中介与直接路径调节模型", body))
            if "验证性因子与结构方程模型" in payload["title"] and amos_figure.is_file():
                story.append(pdf_figure(amos_figure, "图3  Amos 测量模型与结构路径（标准化估计）", body))
            continue

        headers = payload["headers"]
        font_size = 8.0 if len(headers) >= 8 else 8.5 if len(headers) >= 6 else 9.0
        header_cell = ParagraphStyle(
            f"PdfHeader{len(headers)}",
            parent=body,
            fontName=bold_font,
            fontSize=font_size,
            leading=font_size + 2.5,
            alignment=TA_CENTER,
            firstLineIndent=0,
            spaceAfter=0,
            wordWrap="CJK",
        )
        body_cell = ParagraphStyle(
            f"PdfCell{len(headers)}",
            parent=header_cell,
            fontName=regular_font,
        )
        table_data = [
            [pdf_paragraph(value, header_cell) for value in headers],
            *[[pdf_paragraph(value, body_cell) for value in row] for row in payload["rows"]],
        ]
        widths = [width * cm for width in column_widths(headers)]
        report_table = LongTable(
            table_data,
            colWidths=widths,
            repeatRows=1,
            splitByRow=1,
            hAlign="CENTER",
        )
        report_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), bold_font),
            ("FONTNAME", (0, 1), (-1, -1), regular_font),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3.2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2.0),
            ("LINEABOVE", (0, 0), (-1, 0), 0.9, colors.black),
            ("LINEBELOW", (0, 0), (-1, 0), 0.55, colors.black),
            ("LINEBELOW", (0, -1), (-1, -1), 0.9, colors.black),
        ]))
        story.extend([report_table, Spacer(1, 5)])
        if payload["title"].startswith("PV 不同水平") and moderation_figure.is_file():
            story.append(pdf_figure(moderation_figure, "图2  PV 不同水平下 PP→AA 条件效应", body))

    try:
        doc.build(story)
        if not temp_output.is_file() or temp_output.stat().st_size < 1000:
            raise RuntimeError("PDF 文件未生成或大小异常")
        with temp_output.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                raise RuntimeError("PDF 文件头无效")
        os.replace(temp_output, output)
    except Exception as error:
        if temp_output.exists():
            temp_output.unlink()
        if isinstance(error, RuntimeError):
            raise
        raise RuntimeError(f"PDF 生成失败：{error}") from error


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input")
    source.add_argument("--input-json")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--prompt", default="")
    parser.add_argument("--seed", type=int, default=20260712)
    parser.add_argument("--no-documents", action="store_true")
    args = parser.parse_args()
    output_dir = Path(args.output_dir); output_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = output_dir / ".pipeline-staging"
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir()
    try:
        frame = read_data(args); plan = validate_plan(json.loads(Path(args.plan).read_text(encoding="utf-8")))
        if frame.empty or not len(frame.columns):
            raise ValueError("输入数据为空，未生成分析报告")
        uses_amos = "amos" in plan["analysisOrder"]
        result = analyze(frame, plan, args.prompt, seed=args.seed)
        amos_artifacts: list[Path] = []
        if uses_amos:
            amos_result, amos_artifacts = run_amos_analysis(frame, plan, staging_dir, args.seed)
            append_amos_sections(result, amos_result)
        staged_result = staging_dir / "analysis-result.json"
        staged_result.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=json_default, allow_nan=False), encoding="utf-8")
        staged_files = [staged_result, *amos_artifacts]
        if not args.no_documents:
            staged_docx = staging_dir / "问卷数据分析报告.docx"
            create_docx(result, staged_docx)
            staged_pdf = staging_dir / "问卷数据分析报告.pdf"
            create_pdf(result, staged_pdf)
            staged_files.extend([staged_docx, staged_pdf])
            staged_files.extend(path for path in (staging_dir / "研究模型图.png", staging_dir / "调节效应图.png", staging_dir / "AMOS结构方程模型图.png") if path.exists())
        for staged_file in staged_files:
            os.replace(staged_file, output_dir / staged_file.name)
        result_path = output_dir / "analysis-result.json"
        artifacts = {"result": str(result_path.resolve())}
        if uses_amos:
            artifacts.update({
                "amosResult": str((output_dir / "amos-engine-result.json").resolve()),
                "amosRawOutput": str((output_dir / "AMOS原始输出.AmosOutput.html").resolve()),
            })
        if not args.no_documents:
            artifacts.update({
                "docx": str((output_dir / "问卷数据分析报告.docx").resolve()),
                "pdf": str((output_dir / "问卷数据分析报告.pdf").resolve()),
            })
        optional_artifacts = {
            "modelFigure": "研究模型图.png",
            "moderationFigure": "调节效应图.png",
            "amosFigure": "AMOS结构方程模型图.png",
        }
        for role, filename in optional_artifacts.items():
            candidate = output_dir / filename
            if candidate.is_file():
                artifacts[role] = str(candidate.resolve())
        print(json.dumps({"result": result, "artifacts": artifacts}, ensure_ascii=False, default=json_default, allow_nan=False))
    finally:
        if staging_dir.exists():
            shutil.rmtree(staging_dir)


def cli() -> int:
    try:
        main()
    except (ValueError, RuntimeError) as error:
        # Keep the sidecar error contract stable after PyInstaller freezes the
        # script.  An uncaught exception is followed by a PyInstaller footer,
        # which would hide the final business-error line from Electron.
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(cli())
