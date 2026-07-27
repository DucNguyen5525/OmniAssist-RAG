from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

LOCK_PATH = Path(__file__).with_name("pageindex-reference.lock.json")


def setup_gcli_env(env: dict[str, str]) -> dict[str, str]:
    """Forward the OpenAI-compatible GCLI configuration used by PageIndex/LiteLLM."""
    base_url = env.get("GCLI_BASE_URL", "https://gcli.ggchan.dev/v1")
    model = (
        env.get("PAGEINDEX_MODEL")
        or env.get("WORKER_MODEL")
        or env.get("GCLI_MODEL")
        or "gemini-3-flash-preview"
    )
    raw_keys = (
        env.get("GCLI_API_KEYS")
        or env.get("GCLI_API_KEY")
        or env.get("GEMINI_API_KEY")
        or ""
    )
    first_key = ""
    if raw_keys:
        first_entry = raw_keys.split(",")[0].strip()
        first_key = first_entry.split(":")[0].strip()

    if base_url:
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_BASE"] = base_url
    if first_key:
        env["OPENAI_API_KEY"] = first_key
        env["GEMINI_API_KEY"] = first_key
        env["GOOGLE_API_KEY"] = first_key
    env["OPENAI_MODEL_NAME"] = model
    env["PAGEINDEX_MODEL"] = model
    env["WORKER_MODEL"] = model
    return env


def preprocess_source_file(source_path: Path) -> Path:
    """Convert formats unsupported by PageIndex to Markdown before indexing."""
    ext = source_path.suffix.lower()
    if ext in [".pdf", ".md", ".markdown"]:
        return source_path
    if ext == ".txt":
        converted_path = source_path.parent / f"{source_path.stem}_converted.md"
        converted_path.write_text(
            f"# {source_path.stem}\n\n{source_path.read_text(encoding='utf-8')}",
            encoding="utf-8",
        )
        return converted_path

    print(
        f"[Preprocess] Detected '{ext}' file ({source_path.name}). "
        "Converting to Markdown via MarkItDown..."
    )
    try:
        from markitdown import MarkItDown

        result = MarkItDown().convert(str(source_path))
        converted_path = source_path.parent / f"{source_path.stem}_converted.md"
        converted_path.write_text(result.text_content, encoding="utf-8")
        print(f"[Preprocess] Successfully converted -> {converted_path.name}")
        return converted_path
    except ImportError as error:
        raise RuntimeError(
            f"File format '{ext}' requires 'markitdown'. Run: pip install markitdown"
        ) from error
    except Exception as error:
        raise RuntimeError(
            f"Failed to convert '{source_path.name}' via MarkItDown: {error}"
        ) from error


def resolve_pageindex_dir(pageindex_dir: str | None = None) -> Path:
    configured = pageindex_dir or os.getenv("PAGEINDEX_DIR")
    if not configured:
        raise RuntimeError(
            "PageIndex source directory is required. Pass --pageindex-dir or set PAGEINDEX_DIR."
        )
    root = Path(configured).resolve()
    if not (root / "run_pageindex.py").is_file():
        raise RuntimeError(f"{root} is not a compatible VectifyAI/PageIndex checkout.")

    expected = os.getenv("PAGEINDEX_EXPECTED_COMMIT") or load_reference_lock().get("commit")
    actual = get_pageindex_version(root)
    allow_unpinned = os.getenv("PAGEINDEX_ALLOW_UNPINNED", "").lower() == "true"
    if expected and actual != expected and not allow_unpinned:
        raise RuntimeError(
            f"PageIndex commit mismatch: expected {expected}, found {actual}. "
            "Update the lock intentionally or set PAGEINDEX_ALLOW_UNPINNED=true for a one-off test."
        )
    return root


def get_pageindex_version(pageindex_dir: str | Path) -> str:
    root = Path(pageindex_dir).resolve()
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"Cannot determine PageIndex commit for {root}.") from error
    return result.stdout.strip()


def load_reference_lock() -> dict[str, str]:
    return json.loads(LOCK_PATH.read_text(encoding="utf-8"))


def run_pageindex(source: str, output: str, pageindex_dir: str | None = None) -> Path:
    """Run the pinned PageIndex checkout and copy its generated tree to ``output``."""
    source_path = Path(source).resolve()
    if not source_path.is_file():
        raise RuntimeError(f"Source file not found: {source_path}")
    effective_source = preprocess_source_file(source_path)
    output_path = Path(output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    root = resolve_pageindex_dir(pageindex_dir)

    run_env = setup_gcli_env(os.environ.copy())
    model = run_env["PAGEINDEX_MODEL"]
    command_template = os.getenv("PAGEINDEX_COMMAND")
    if command_template:
        formatted = command_template.format(
            source=str(effective_source),
            output=str(output_path),
            pageindex_dir=str(root),
            model=model,
        )
        command = shlex.split(formatted, posix=os.name != "nt")
        subprocess.run(command, cwd=root, check=True, env=run_env)
        produced_path = output_path
    else:
        source_flag = "--pdf_path" if effective_source.suffix.lower() == ".pdf" else "--md_path"
        command = [
            sys.executable,
            str(root / "run_pageindex.py"),
            source_flag,
            str(effective_source),
            "--model",
            model,
            # OmniAssist retrieves directly from the persisted tree. PageIndex
            # defaults this to "no", which produces useful routing summaries but
            # no evidence text for answer generation.
            "--if-add-node-text",
            "yes",
        ]
        subprocess.run(command, cwd=root, check=True, env=run_env)
        produced_path = root / "results" / f"{effective_source.stem}_structure.json"

    if not produced_path.is_file():
        raise RuntimeError(
            f"PageIndex completed without creating the expected JSON output: {produced_path}"
        )
    try:
        json.loads(produced_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"PageIndex output is not valid UTF-8 JSON: {produced_path}") from error

    if produced_path.resolve() != output_path:
        shutil.copy2(produced_path, output_path)
    return output_path


def main() -> None:
    from dotenv import load_dotenv

    root_env = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(root_env if root_env.exists() else None)

    parser = argparse.ArgumentParser(description="Run the pinned PageIndex checkout.")
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pageindex-dir")
    args = parser.parse_args()
    output = run_pageindex(args.source, args.output, args.pageindex_dir)
    root = resolve_pageindex_dir(args.pageindex_dir)
    print(
        json.dumps(
            {"output": str(output), "producerVersion": get_pageindex_version(root)},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
