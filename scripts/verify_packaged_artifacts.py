from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import pypdfium2 as pdfium
    from docx import Document
    from docx.oxml.ns import qn
except ImportError as error:  # pragma: no cover - exercised only on a broken QA workstation
    raise SystemExit(
        "QA 运行时缺少 python-docx 或 pypdfium2；它们仅用于外部验收，不是产品运行依赖。"
    ) from error


ROOT = Path(__file__).resolve().parents[1]
HISTORICAL_OUTPUTS = (ROOT / "outputs").resolve()
RESULT_NAME = "analysis-result.json"
DOCX_NAME = "问卷数据分析报告.docx"
PDF_NAME = "问卷数据分析报告.pdf"
FIGURE_NAMES = ("研究模型图.png", "调节效应图.png")
EXPECTED_SEED = 20260712
EXPECTED_BOOTSTRAP_SAMPLES = 5000
EXPECTED_BOOTSTRAP_FINGERPRINT = "0955FC8547DD41AC6F3F84FD1B5ED93FA18D68C4E8C2D768FCBFBAE174DD1E11"
FLOAT_TOLERANCE = 1e-9

FULL_SECTIONS = [
    "1、数据质量与变量识别",
    "2、频数分析",
    "3、描述统计",
    "4、信度检验",
    "5、主成分结构检查（PCA+Varimax）",
    "6、相关性分析",
    "7、并行中介与调节作用",
    "8、综合结论",
]
RELIABILITY_SECTIONS = ["1、数据质量与变量识别", "2、信度检验"]
FULL_SCOPE = ["data-quality", "frequency", "descriptive", "reliability", "efa", "correlation", "model"]
RELIABILITY_SCOPE = ["data-quality", "reliability"]
RELIABILITY_RAW_KEYS = {
    "prompt",
    "planSummary",
    "analysisScope",
    "seed",
    "dataQuality",
    "reliability",
}
CORE_FULL_TABLES = [
    "人口学变量频数分布",
    "变量描述及变量分布",
    "信度检验结果",
    "KMO 与 Bartlett 检验",
    "主成分方差解释率",
    "旋转后成分载荷",
    "维度相关矩阵",
    "中介变量回归模型",
    "结果变量模型汇总",
    "结果变量回归模型",
    "Bootstrap 并行中介效应",
    "PV 不同水平下 PP→AA 简单斜率",
]
FORBIDDEN_RELIABILITY_TEXT = [
    "频数分析",
    "描述统计",
    "主成分结构检查（PCA+Varimax）",
    "相关性分析",
    "并行中介与调节作用",
    "综合结论",
    "KMO 与 Bartlett 检验",
    "Bootstrap 并行中介效应",
]
BENCHMARK = {
    "kmo": 0.8971807579830153,
    "alphas": {
        "PP": 0.9290370042867071,
        "AA": 0.893457899907147,
        "PC": 0.9223309487326403,
        "PI": 0.9454808149932017,
        "PV": 0.9288918429975316,
    },
    "outcomeModel": {
        "const": 1.1033939255207585,
        "PP_c": 0.20422941187812949,
        "PC": 0.20895105718546697,
        "PI": 0.41725991738856594,
        "PV_c": -0.15910984960128077,
        "interaction": 0.12192767776172439,
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest().upper()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON 根节点必须是对象：{path}")
    return value


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value).replace("\u00a0", "")


def section_titles(result: dict[str, Any]) -> list[str]:
    return [
        str(item.get("title", ""))
        for item in result.get("tables", [])
        if isinstance(item, dict)
        and item.get("type") == "text"
        and re.match(r"^\d+、", str(item.get("title", "")))
    ]


def close_enough(actual: Any, expected: float) -> bool:
    try:
        return abs(float(actual) - expected) <= FLOAT_TOLERANCE
    except (TypeError, ValueError):
        return False


@dataclass
class QARecorder:
    checks: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def check(self, name: str, passed: bool, detail: Any = None) -> bool:
        entry: dict[str, Any] = {"name": name, "passed": bool(passed)}
        if detail is not None:
            entry["detail"] = detail
        self.checks.append(entry)
        if not passed:
            message = name if detail is None else f"{name}：{detail}"
            self.errors.append(message)
        return bool(passed)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def recursive_first(value: Any, keys: set[str]) -> Any:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in keys and isinstance(item, (str, os.PathLike)):
                return item
        for item in value.values():
            found = recursive_first(item, keys)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = recursive_first(item, keys)
            if found is not None:
                return found
    return None


def recursive_boolean(value: Any, key_name: str) -> bool | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == key_name and isinstance(item, bool):
                return item
        for item in value.values():
            found = recursive_boolean(item, key_name)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = recursive_boolean(item, key_name)
            if found is not None:
                return found
    return None


def path_from_manifest(value: Any, manifest_path: Path) -> Path | None:
    if not isinstance(value, (str, os.PathLike)):
        return None
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = manifest_path.parent / candidate
    candidate = candidate.resolve()
    if candidate.name in {RESULT_NAME, DOCX_NAME, PDF_NAME}:
        return candidate.parent
    return candidate


def find_manifest(evidence_root: Path) -> Path | None:
    names = (
        "packaged-e2e-summary.json",
        "e2e-summary.json",
        "machine-summary.json",
        "evidence-manifest.json",
        "manifest.json",
    )
    for name in names:
        direct = evidence_root / name
        if direct.is_file():
            return direct
    candidates = [
        path
        for path in evidence_root.glob("*.json")
        if "summary" in path.name.lower() or "manifest" in path.name.lower()
    ]
    return sorted(candidates)[0] if candidates else None


def discover_jobs(evidence_root: Path) -> dict[str, list[Path]]:
    discovered: dict[str, list[Path]] = {"full": [], "reliability": []}
    for result_path in sorted(evidence_root.rglob(RESULT_NAME)):
        relative_parts = [part.lower() for part in result_path.relative_to(evidence_root).parts]
        if "visual" in relative_parts or "docx-qa" in relative_parts:
            continue
        try:
            result = read_json(result_path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        raw = result.get("raw", {})
        titles = section_titles(result)
        if titles == FULL_SECTIONS and isinstance(raw, dict) and "outcomeModel" in raw:
            discovered["full"].append(result_path.parent.resolve())
        elif titles == RELIABILITY_SECTIONS and isinstance(raw, dict) and "reliability" in raw:
            discovered["reliability"].append(result_path.parent.resolve())
    return discovered


def choose_primary_full(paths: Iterable[Path]) -> Path | None:
    candidates = list(dict.fromkeys(path.resolve() for path in paths))
    if not candidates:
        return None
    candidates.sort(
        key=lambda path: (
            "repeat" in path.name.lower(),
            "full" not in path.name.lower(),
            str(path).lower(),
        )
    )
    return candidates[0]


def choose_repeat(paths: Iterable[Path], primary: Path | None) -> Path | None:
    candidates = [path.resolve() for path in paths if primary is None or path.resolve() != primary.resolve()]
    if not candidates:
        return None
    candidates.sort(key=lambda path: ("repeat" not in path.name.lower(), str(path).lower()))
    return candidates[0]


def inspect_docx(path: Path) -> dict[str, Any]:
    document = Document(path)
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    titles = [value for value in paragraphs if re.match(r"^\d+、", value)]
    three_line_tables = 0
    for table in document.tables:
        borders = table._tbl.tblPr.find(qn("w:tblBorders"))
        if (
            borders is not None
            and borders.find(qn("w:top")) is not None
            and borders.find(qn("w:bottom")) is not None
        ):
            three_line_tables += 1
    with zipfile.ZipFile(path) as archive:
        media = [name for name in archive.namelist() if name.startswith("word/media/")]
        xml = archive.read("word/document.xml").decode("utf-8")
    return {
        "title": paragraphs[0] if paragraphs else "",
        "sectionTitles": titles,
        "paragraphText": "\n".join(paragraphs),
        "tableCount": len(document.tables),
        "threeLineTableCount": three_line_tables,
        "imageCount": len(media),
        "hasSongFont": "宋体" in xml,
        "hasHeiFont": "黑体" in xml,
        "pageWidthCm": round(document.sections[0].page_width.cm, 3) if document.sections else None,
        "pageHeightCm": round(document.sections[0].page_height.cm, 3) if document.sections else None,
    }


def inspect_and_render_pdf(path: Path, output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(path)
    page_texts: list[str] = []
    rendered: list[str] = []
    try:
        for index in range(len(document)):
            page = document[index]
            try:
                text_page = page.get_textpage()
                try:
                    page_texts.append(text_page.get_text_range())
                finally:
                    text_page.close()
                target = output_dir / f"page-{index + 1:03d}.png"
                bitmap = page.render(scale=2.0)
                try:
                    bitmap.to_pil().save(target, format="PNG")
                finally:
                    bitmap.close()
                rendered.append(str(target))
            finally:
                page.close()
    finally:
        document.close()
    return {
        "pageCount": len(page_texts),
        "text": "\n".join(page_texts),
        "renderedPages": rendered,
    }


def find_libreoffice(explicit: str | None) -> Path | None:
    if explicit:
        candidate = Path(explicit).resolve()
        return candidate if candidate.is_file() else None
    from_path = shutil.which("soffice") or shutil.which("soffice.exe")
    if from_path:
        return Path(from_path).resolve()
    candidates = [
        Path(os.environ.get("PROGRAMFILES", "")) / "LibreOffice" / "program" / "soffice.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "LibreOffice" / "program" / "soffice.exe",
        Path("D:/LibreOffice/program/soffice.exe"),
    ]
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


def convert_docx_with_libreoffice(
    source: Path,
    role: str,
    visual_root: Path,
    soffice: Path | None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "attempted": bool(soffice),
        "success": False,
        "source": str(source),
    }
    if soffice is None:
        result["reason"] = "未发现 LibreOffice；DOCX 转 PDF 属于外部视觉 QA，不是产品依赖。"
        return result

    qa_dir = visual_root / "docx-qa" / role
    qa_dir.mkdir(parents=True, exist_ok=True)
    result["qaDirectory"] = str(qa_dir)
    result["asciiQaDirectory"] = str(qa_dir).isascii()
    if not str(qa_dir).isascii():
        result["reason"] = "QA 目录不是纯 ASCII，跳过 LibreOffice 转换以避免路径误判。"
        return result

    copied_docx = qa_dir / "report.docx"
    shutil.copy2(source, copied_docx)
    profile = qa_dir / "lo-profile"
    profile.mkdir(exist_ok=True)
    command = [
        str(soffice),
        "--headless",
        f"-env:UserInstallation={profile.as_uri()}",
        "--convert-to",
        "pdf",
        "--outdir",
        str(qa_dir),
        str(copied_docx),
    ]
    started = time.perf_counter()
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        completed = subprocess.run(
            command,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=90,
            creationflags=creation_flags,
        )
        result.update(
            {
                "durationSeconds": round(time.perf_counter() - started, 3),
                "returnCode": completed.returncode,
                "stdout": completed.stdout.strip(),
                "stderr": completed.stderr.strip(),
            }
        )
    except subprocess.TimeoutExpired as error:
        result.update(
            {
                "durationSeconds": round(time.perf_counter() - started, 3),
                "reason": "LibreOffice 转换超过 90 秒，已终止等待。",
                "stdout": (error.stdout or "") if isinstance(error.stdout, str) else "",
                "stderr": (error.stderr or "") if isinstance(error.stderr, str) else "",
            }
        )
        return result

    converted = qa_dir / "report.pdf"
    if completed.returncode != 0 or not converted.is_file() or converted.stat().st_size < 1000:
        result["reason"] = "LibreOffice 未生成有效 PDF。"
        return result
    rendered = inspect_and_render_pdf(converted, visual_root / f"docx-{role}")
    result.update(
        {
            "success": True,
            "convertedPdf": str(converted),
            "convertedPdfSha256": sha256(converted),
            "pageCount": rendered["pageCount"],
            "renderedPages": rendered["renderedPages"],
        }
    )
    return result


def artifact_inventory(job: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for name in (RESULT_NAME, DOCX_NAME, PDF_NAME, *FIGURE_NAMES):
        path = job / name
        if path.is_file():
            items.append(
                {
                    "name": name,
                    "path": str(path),
                    "size": path.stat().st_size,
                    "sha256": sha256(path),
                }
            )
    return items


def inspect_result(
    role: str,
    job: Path,
    recorder: QARecorder,
) -> dict[str, Any] | None:
    result_path = job / RESULT_NAME
    if not recorder.check(f"{role}.json.exists", result_path.is_file(), str(result_path)):
        return None
    try:
        result = read_json(result_path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        recorder.check(f"{role}.json.parse", False, str(error))
        return None
    recorder.check(f"{role}.json.parse", True)
    recorder.check(
        f"{role}.methodId",
        result.get("methodId") == "scientific-questionnaire",
        result.get("methodId"),
    )
    return result


def check_full_science(result: dict[str, Any], recorder: QARecorder) -> dict[str, Any]:
    raw = result.get("raw", {})
    recorder.check("full.sections", section_titles(result) == FULL_SECTIONS, section_titles(result))
    recorder.check("full.analysisScope", raw.get("analysisScope") == FULL_SCOPE, raw.get("analysisScope"))
    quality = raw.get("dataQuality", {})
    recorder.check(
        "full.syntheticShape",
        quality.get("sampleSize") == 160 and quality.get("variableCount") == 26,
        quality,
    )
    recorder.check("full.seed", raw.get("seed") == EXPECTED_SEED, raw.get("seed"))
    recorder.check(
        "full.bootstrapSamples",
        raw.get("bootstrapSamples") == EXPECTED_BOOTSTRAP_SAMPLES,
        raw.get("bootstrapSamples"),
    )
    recorder.check("science.kmo", close_enough(raw.get("kmo"), BENCHMARK["kmo"]), raw.get("kmo"))
    alphas = raw.get("reliability", {})
    for name, expected in BENCHMARK["alphas"].items():
        recorder.check(f"science.alpha.{name}", close_enough(alphas.get(name), expected), alphas.get(name))
    outcome = raw.get("outcomeModel", {})
    for name, expected in BENCHMARK["outcomeModel"].items():
        recorder.check(f"science.ols.{name}", close_enough(outcome.get(name), expected), outcome.get(name))
    bootstrap_payload = {"indirect": raw.get("indirect"), "slopes": raw.get("slopes")}
    bootstrap_fingerprint = canonical_sha256(bootstrap_payload)
    recorder.check(
        "science.fixedSeedBootstrapFingerprint",
        bootstrap_fingerprint == EXPECTED_BOOTSTRAP_FINGERPRINT,
        bootstrap_fingerprint,
    )
    return {
        "seed": raw.get("seed"),
        "bootstrapSamples": raw.get("bootstrapSamples"),
        "bootstrapFingerprint": bootstrap_fingerprint,
        "expectedBootstrapFingerprint": EXPECTED_BOOTSTRAP_FINGERPRINT,
        "kmo": raw.get("kmo"),
        "alphas": alphas,
        "outcomeModel": outcome,
    }


def check_reliability_result(
    result: dict[str, Any],
    full_result: dict[str, Any] | None,
    recorder: QARecorder,
) -> dict[str, Any]:
    raw = result.get("raw", {})
    titles = section_titles(result)
    recorder.check("reliability.sections", titles == RELIABILITY_SECTIONS, titles)
    recorder.check(
        "reliability.analysisScope",
        raw.get("analysisScope") == RELIABILITY_SCOPE,
        raw.get("analysisScope"),
    )
    recorder.check("reliability.rawKeys", set(raw) == RELIABILITY_RAW_KEYS, sorted(raw))
    recorder.check("reliability.seed", raw.get("seed") == EXPECTED_SEED, raw.get("seed"))
    quality = raw.get("dataQuality", {})
    recorder.check(
        "reliability.syntheticShape",
        quality.get("sampleSize") == 160 and quality.get("variableCount") == 26,
        quality,
    )
    alphas = raw.get("reliability", {})
    for name, expected in BENCHMARK["alphas"].items():
        recorder.check(
            f"reliability.alpha.{name}",
            close_enough(alphas.get(name), expected),
            alphas.get(name),
        )
    if full_result is not None:
        full_alphas = full_result.get("raw", {}).get("reliability")
        recorder.check("reliability.matchesFull", alphas == full_alphas)
    return {"sections": titles, "rawKeys": sorted(raw), "alphas": alphas}


def check_repeat(
    repeat: dict[str, Any] | None,
    full: dict[str, Any],
    recorder: QARecorder,
) -> dict[str, Any]:
    if repeat is None:
        recorder.warn(
            "未提供第二次完整任务；固定种子已通过冻结 synthetic Bootstrap 指纹复核，但未做同包双跑逐值比较。"
        )
        return {"provided": False, "baselineFingerprintMatched": True}
    raw = full.get("raw", {})
    repeat_raw = repeat.get("raw", {})
    keys = ("seed", "reliability", "kmo", "outcomeModel", "indirect", "slopes")
    comparisons = {key: repeat_raw.get(key) == raw.get(key) for key in keys}
    recorder.check("repeat.sections", section_titles(repeat) == FULL_SECTIONS, section_titles(repeat))
    recorder.check("repeat.fixedSeedSelectedValues", all(comparisons.values()), comparisons)
    return {"provided": True, "selectedValueEquality": comparisons}


def check_docx_role(
    role: str,
    job: Path,
    recorder: QARecorder,
) -> dict[str, Any] | None:
    path = job / DOCX_NAME
    if not recorder.check(f"{role}.docx.exists", path.is_file() and path.stat().st_size >= 1000, str(path)):
        return None
    try:
        info = inspect_docx(path)
    except Exception as error:  # python-docx/ZIP gives actionable parser failures
        recorder.check(f"{role}.docx.parse", False, repr(error))
        return None
    recorder.check(f"{role}.docx.parse", True)
    recorder.check(f"{role}.docx.title", "数据分析报告" in info["title"], info["title"])
    recorder.check(
        f"{role}.docx.a4",
        abs((info["pageWidthCm"] or 0) - 21.0) < 0.1
        and abs((info["pageHeightCm"] or 0) - 29.7) < 0.1,
        {"widthCm": info["pageWidthCm"], "heightCm": info["pageHeightCm"]},
    )
    expected_sections = FULL_SECTIONS if role == "full" else RELIABILITY_SECTIONS
    expected_tables = len(CORE_FULL_TABLES) if role == "full" else 1
    expected_images = 2 if role == "full" else 0
    recorder.check(f"{role}.docx.sections", info["sectionTitles"] == expected_sections, info["sectionTitles"])
    recorder.check(f"{role}.docx.tableCount", info["tableCount"] == expected_tables, info["tableCount"])
    recorder.check(
        f"{role}.docx.threeLineTables",
        info["threeLineTableCount"] == info["tableCount"],
        {"tables": info["tableCount"], "threeLine": info["threeLineTableCount"]},
    )
    recorder.check(f"{role}.docx.imageCount", info["imageCount"] == expected_images, info["imageCount"])
    recorder.check(
        f"{role}.docx.chineseFonts",
        info["hasSongFont"] and info["hasHeiFont"],
        {"song": info["hasSongFont"], "hei": info["hasHeiFont"]},
    )
    normalized = normalize_text(info["paragraphText"])
    required = CORE_FULL_TABLES if role == "full" else ["信度检验结果"]
    recorder.check(
        f"{role}.docx.coreTableTitles",
        all(normalize_text(title) in normalized for title in required),
        [title for title in required if normalize_text(title) not in normalized],
    )
    if role == "reliability":
        leaked = [text for text in FORBIDDEN_RELIABILITY_TEXT if normalize_text(text) in normalized]
        recorder.check("reliability.docx.noScopeLeak", not leaked, leaked)
    return {key: value for key, value in info.items() if key != "paragraphText"}


def check_pdf_role(
    role: str,
    job: Path,
    visual_root: Path,
    recorder: QARecorder,
) -> dict[str, Any] | None:
    path = job / PDF_NAME
    if not recorder.check(f"{role}.pdf.exists", path.is_file() and path.stat().st_size >= 1000, str(path)):
        return None
    try:
        info = inspect_and_render_pdf(path, visual_root / f"pdf-{role}")
    except Exception as error:
        recorder.check(f"{role}.pdf.parseAndRender", False, repr(error))
        return None
    recorder.check(f"{role}.pdf.parseAndRender", True)
    page_count = info["pageCount"]
    if role == "full":
        recorder.check("full.pdf.pageCount", page_count == 8, page_count)
    else:
        recorder.check("reliability.pdf.pageCount", 1 <= page_count <= 3, page_count)
    recorder.check(
        f"{role}.pdf.allPagesRendered",
        len(info["renderedPages"]) == page_count
        and all(Path(path).is_file() for path in info["renderedPages"]),
        len(info["renderedPages"]),
    )
    normalized = normalize_text(info["text"])
    expected_sections = FULL_SECTIONS if role == "full" else RELIABILITY_SECTIONS
    recorder.check(
        f"{role}.pdf.chineseSectionText",
        all(normalize_text(title) in normalized for title in expected_sections),
        [title for title in expected_sections if normalize_text(title) not in normalized],
    )
    required = CORE_FULL_TABLES if role == "full" else ["信度检验结果"]
    recorder.check(
        f"{role}.pdf.coreTableTitles",
        all(normalize_text(title) in normalized for title in required),
        [title for title in required if normalize_text(title) not in normalized],
    )
    if role == "full":
        recorder.check(
            "full.pdf.figureCaptions",
            normalize_text("图1  并行中介与直接路径调节模型") in normalized
            and normalize_text("图2  PV 不同水平下 PP→AA 条件效应") in normalized,
        )
    else:
        leaked = [text for text in FORBIDDEN_RELIABILITY_TEXT if normalize_text(text) in normalized]
        recorder.check("reliability.pdf.noScopeLeak", not leaked, leaked)
        recorder.check("reliability.pdf.noFigureCaptions", "图1" not in normalized and "图2" not in normalized)
    return {
        "pageCount": page_count,
        "textCharacters": len(info["text"]),
        "renderedPages": info["renderedPages"],
    }


def check_figure_files(role: str, job: Path, recorder: QARecorder) -> dict[str, Any]:
    present = {name: (job / name).is_file() and (job / name).stat().st_size >= 1000 for name in FIGURE_NAMES}
    expected = role == "full"
    recorder.check(f"{role}.figureFiles", all(value == expected for value in present.values()), present)
    return present


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="验收 packaged synthetic 问卷报告；只读取指定证据目录，不读取项目历史 outputs。"
    )
    parser.add_argument("--evidence-root", help="packaged E2E 证据根目录")
    parser.add_argument("--manifest", help="packaged E2E summary/manifest JSON")
    parser.add_argument("--full-job", help="完整分析任务目录")
    parser.add_argument("--reliability-job", help="只做信度任务目录")
    parser.add_argument("--repeat-job", help="可选：第二次完整分析任务目录，用于同包逐值复现")
    parser.add_argument("--libreoffice", help="可选：soffice.exe 路径")
    return parser.parse_args()


def markdown_report(summary: dict[str, Any]) -> str:
    passed = sum(1 for item in summary["checks"] if item["passed"])
    failed = len(summary["checks"]) - passed
    lines = [
        "# Packaged artifact QA",
        "",
        f"- 状态：**{summary['status']}**",
        f"- 生成时间：{summary['generatedAt']}",
        f"- 证据目录：`{summary['evidenceRoot']}`",
        f"- 检查：{passed} 通过 / {failed} 失败",
        f"- synthetic 固定基准：{'通过' if summary.get('syntheticOnly') else '未通过'}",
        "",
        "## 科学复核",
        "",
        f"- KMO：{summary.get('science', {}).get('kmo')}",
        f"- 固定种子：{summary.get('science', {}).get('seed')}",
        f"- Bootstrap 指纹：`{summary.get('science', {}).get('bootstrapFingerprint', '')}`",
        f"- 双跑逐值比较：{'已执行' if summary.get('repeat', {}).get('provided') else '未提供；已对冻结基准指纹'}",
        "",
        "## 文档与视觉",
        "",
        f"- 完整 PDF 页数：{summary.get('documents', {}).get('fullPdf', {}).get('pageCount')}",
        f"- 限定 PDF 页数：{summary.get('documents', {}).get('reliabilityPdf', {}).get('pageCount')}",
        f"- 全页渲染目录：`{summary.get('visualRoot', '')}`",
    ]
    if summary["errors"]:
        lines.extend(["", "## 失败项", ""] + [f"- {item}" for item in summary["errors"]])
    if summary["warnings"]:
        lines.extend(["", "## 警告", ""] + [f"- {item}" for item in summary["warnings"]])
    lines.extend(
        [
            "",
            "## 边界",
            "",
            "本工具只验收指定 evidence 中与冻结 synthetic 科学基准一致的产物；LibreOffice 仅用于外部 DOCX 视觉 QA，不属于产品运行时。",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    if not any((args.evidence_root, args.manifest, args.full_job, args.reliability_job)):
        raise SystemExit("必须提供 --evidence-root/--manifest，或同时提供 --full-job 与 --reliability-job。")
    if bool(args.full_job) != bool(args.reliability_job):
        raise SystemExit("直接传任务目录时，--full-job 与 --reliability-job 必须同时提供。")

    manifest_path = Path(args.manifest).resolve() if args.manifest else None
    explicit_jobs = [Path(value).resolve() for value in (args.full_job, args.reliability_job, args.repeat_job) if value]
    if args.evidence_root:
        evidence_root = Path(args.evidence_root).resolve()
    elif manifest_path:
        evidence_root = manifest_path.parent.resolve()
    else:
        common = Path(os.path.commonpath([str(path) for path in explicit_jobs]))
        evidence_root = common if common.is_dir() else common.parent
    if not evidence_root.is_dir():
        raise SystemExit(f"证据目录不存在：{evidence_root}")
    if is_relative_to(evidence_root, HISTORICAL_OUTPUTS):
        raise SystemExit(f"拒绝读取项目历史 outputs：{evidence_root}")

    if manifest_path is None:
        manifest_path = find_manifest(evidence_root)
    manifest: dict[str, Any] = {}
    if manifest_path:
        if not manifest_path.is_file():
            raise SystemExit(f"manifest 不存在：{manifest_path}")
        if not is_relative_to(manifest_path, evidence_root):
            raise SystemExit(f"manifest 必须位于 evidence 内：{manifest_path}")
        manifest = read_json(manifest_path)

    full_job = Path(args.full_job).resolve() if args.full_job else None
    reliability_job = Path(args.reliability_job).resolve() if args.reliability_job else None
    repeat_job = Path(args.repeat_job).resolve() if args.repeat_job else None
    if manifest_path:
        full_job = full_job or path_from_manifest(
            recursive_first(manifest, {"fullReportDir", "fullJobDir", "fullOutputDir", "fullJob"}),
            manifest_path,
        )
        reliability_job = reliability_job or path_from_manifest(
            recursive_first(
                manifest,
                {"limitedReportDir", "reliabilityReportDir", "reliabilityJobDir", "limitedJobDir", "reliabilityJob"},
            ),
            manifest_path,
        )
        repeat_job = repeat_job or path_from_manifest(
            recursive_first(manifest, {"repeatReportDir", "fullRepeatReportDir", "repeatJobDir", "repeatJob"}),
            manifest_path,
        )

    discovered = discover_jobs(evidence_root)
    full_job = full_job or choose_primary_full(discovered["full"])
    reliability_job = reliability_job or (discovered["reliability"][0] if discovered["reliability"] else None)
    repeat_job = repeat_job or choose_repeat(discovered["full"], full_job)
    if full_job is None or reliability_job is None:
        raise SystemExit(
            "未能在 evidence/manifest 中定位完整分析和只做信度任务；可显式传 --full-job 与 --reliability-job。"
        )

    recorder = QARecorder()
    jobs = {"full": full_job, "reliability": reliability_job, "repeat": repeat_job}
    for role, job in jobs.items():
        if job is None:
            continue
        recorder.check(f"path.{role}.exists", job.is_dir(), str(job))
        recorder.check(f"path.{role}.insideEvidence", is_relative_to(job, evidence_root), str(job))
        recorder.check(f"path.{role}.notHistoricalOutputs", not is_relative_to(job, HISTORICAL_OUTPUTS), str(job))

    run_stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    visual_root = evidence_root / "visual" / f"artifact-qa-{run_stamp}"
    visual_root.mkdir(parents=True, exist_ok=False)

    manifest_synthetic = recursive_boolean(manifest, "syntheticOnly") if manifest else None
    if manifest_synthetic is not None:
        recorder.check("manifest.syntheticOnly", manifest_synthetic, manifest_synthetic)

    full_result = inspect_result("full", full_job, recorder)
    reliability_result = inspect_result("reliability", reliability_job, recorder)
    repeat_result = inspect_result("repeat", repeat_job, recorder) if repeat_job else None

    science: dict[str, Any] = {}
    repeat_summary: dict[str, Any] = {"provided": False}
    reliability_summary: dict[str, Any] = {}
    if full_result is not None:
        science = check_full_science(full_result, recorder)
        repeat_summary = check_repeat(repeat_result, full_result, recorder)
    if reliability_result is not None:
        reliability_summary = check_reliability_result(reliability_result, full_result, recorder)

    full_docx = check_docx_role("full", full_job, recorder)
    reliability_docx = check_docx_role("reliability", reliability_job, recorder)
    full_pdf = check_pdf_role("full", full_job, visual_root, recorder)
    reliability_pdf = check_pdf_role("reliability", reliability_job, visual_root, recorder)
    figures = {
        "full": check_figure_files("full", full_job, recorder),
        "reliability": check_figure_files("reliability", reliability_job, recorder),
    }

    soffice = find_libreoffice(args.libreoffice)
    lo_checks = {
        "full": convert_docx_with_libreoffice(full_job / DOCX_NAME, "full", visual_root, soffice)
        if (full_job / DOCX_NAME).is_file()
        else {"attempted": False, "success": False, "reason": "DOCX 不存在"},
        "reliability": convert_docx_with_libreoffice(
            reliability_job / DOCX_NAME,
            "reliability",
            visual_root,
            soffice,
        )
        if (reliability_job / DOCX_NAME).is_file()
        else {"attempted": False, "success": False, "reason": "DOCX 不存在"},
    }
    for role, value in lo_checks.items():
        if not value.get("success"):
            recorder.warn(f"{role} DOCX LibreOffice 视觉转换未完成：{value.get('reason', '未知原因')}")

    synthetic_baseline_passed = all(
        item["passed"]
        for item in recorder.checks
        if item["name"].startswith(("full.syntheticShape", "science.", "reliability.alpha"))
    )
    recorder.check("synthetic.frozenBaseline", synthetic_baseline_passed)

    artifacts = {
        "full": artifact_inventory(full_job),
        "reliability": artifact_inventory(reliability_job),
        "repeat": artifact_inventory(repeat_job) if repeat_job else [],
    }
    summary: dict[str, Any] = {
        "schemaVersion": "1.0",
        "status": "failed" if recorder.errors else "passed",
        "generatedAt": utc_now(),
        "syntheticOnly": synthetic_baseline_passed and manifest_synthetic is not False,
        "evidenceRoot": str(evidence_root),
        "manifest": str(manifest_path) if manifest_path else None,
        "jobs": {key: str(value) if value else None for key, value in jobs.items()},
        "science": science,
        "repeat": repeat_summary,
        "reliabilityScope": reliability_summary,
        "documents": {
            "fullDocx": full_docx,
            "reliabilityDocx": reliability_docx,
            "fullPdf": full_pdf,
            "reliabilityPdf": reliability_pdf,
            "figureFiles": figures,
            "libreOfficeVisualQA": lo_checks,
        },
        "artifactHashes": artifacts,
        "visualRoot": str(visual_root),
        "checks": recorder.checks,
        "warnings": recorder.warnings,
        "errors": recorder.errors,
    }

    json_path = evidence_root / "artifact-qa.json"
    markdown_path = evidence_root / "artifact-qa.md"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path.write_text(markdown_report(summary), encoding="utf-8")
    print(
        json.dumps(
            {
                "status": summary["status"],
                "artifactQa": str(json_path),
                "markdown": str(markdown_path),
                "visualRoot": str(visual_root),
                "passedChecks": sum(1 for item in recorder.checks if item["passed"]),
                "failedChecks": sum(1 for item in recorder.checks if not item["passed"]),
                "warnings": len(recorder.warnings),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if recorder.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
