#!/usr/bin/env python3
r"""
apply-update.py  --  reads Update-2026.docx and writes every file it contains
into the deployed project, making a .bak backup of each file it replaces.

--------------------------------------------------------------------------
WHAT YOU NEED INSTALLED
--------------------------------------------------------------------------
  * Python 3.8+            -> this script uses ONLY the standard library
                              (zipfile, base64, json, re). No `pip install`.
  * The project itself     -> Node.js 18+ and `npm install` as usual.

This update adds NO new npm dependencies and NO build step, so after applying
you do not strictly need to reinstall anything. Recommended sequence:

    python apply-update.py "C:\path\to\project"     # writes the files
    cd "C:\path\to\project"
    npm install        # optional (nothing new), just to be safe
    git add -A
    git commit -m "2026 feature update: tracking, PWA, analytics, dark mode, security"
    git push           # Render auto-deploys

  Optional new environment variable (all have safe defaults):
    CORS_ORIGIN   comma-separated allow-list for Socket.IO (default: same-origin)
    APP_NAME      display name (default: Avenza)

--------------------------------------------------------------------------
USAGE
--------------------------------------------------------------------------
    python apply-update.py [TARGET_DIR] [DOC_PATH]

  TARGET_DIR : project root to write into. Default: current directory.
  DOC_PATH   : the .docx to read. Default: Update-2026.docx next to this
               script, then in TARGET_DIR, then in the current directory.

    python apply-update.py                         # cwd + ./Update-2026.docx
    python apply-update.py "C:\proj"               # write into C:\proj
    python apply-update.py "C:\proj" "C:\d\U.docx" # explicit doc
"""
import base64
import json
import os
import re
import sys
import zipfile

DEFAULT_DOC_NAME = "Update-2026.docx"
BEGIN = "##AVENZA_UPDATE_2026_BEGIN##"
END = "##AVENZA_UPDATE_2026_END##"
MAKE_BACKUP = True

HERE = os.path.dirname(os.path.abspath(__file__))


def find_doc(target_dir, explicit):
    candidates = []
    if explicit:
        candidates.append(explicit)
    candidates.append(os.path.join(HERE, DEFAULT_DOC_NAME))
    candidates.append(os.path.join(target_dir, DEFAULT_DOC_NAME))
    candidates.append(os.path.join(os.getcwd(), DEFAULT_DOC_NAME))
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    raise SystemExit(
        "Could not find %s. Pass its path as the 2nd argument.\nLooked in:\n  %s"
        % (DEFAULT_DOC_NAME, "\n  ".join(candidates))
    )


def read_document_xml(docx_path):
    with zipfile.ZipFile(docx_path, "r") as z:
        return z.read("word/document.xml").decode("utf-8")


def extract_payload(document_xml):
    # Strip all XML tags so text runs concatenate, then unescape the few XML
    # entities Word uses. Markers and base64 are pure ASCII and survive intact.
    text = re.sub(r"<[^>]+>", "", document_xml)
    text = (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )
    start = text.find(BEGIN)
    end = text.find(END)
    if start == -1 or end == -1 or end <= start:
        raise SystemExit("Payload markers not found in the document. Is this the right .docx?")
    region = text[start + len(BEGIN):end]
    # Keep only valid base64 characters (drops any whitespace/newlines Word added).
    b64 = re.sub(r"[^A-Za-z0-9+/=]", "", region)
    raw = base64.b64decode(b64)
    return json.loads(raw.decode("utf-8"))


def write_file(target_dir, rel_path, content):
    dest = os.path.join(target_dir, rel_path.replace("/", os.sep))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    replaced = os.path.isfile(dest)
    if replaced and MAKE_BACKUP:
        bak = dest + ".bak"
        with open(dest, "r", encoding="utf-8", errors="replace") as fh:
            old = fh.read()
        with open(bak, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(old)
    # newline="\n" keeps line endings identical to the source (no CRLF surprises).
    with open(dest, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)
    return "replaced" if replaced else "created"


def main():
    target_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
    explicit_doc = sys.argv[2] if len(sys.argv) > 2 else None

    if not os.path.isdir(target_dir):
        raise SystemExit("Target directory does not exist: %s" % target_dir)

    doc_path = find_doc(target_dir, explicit_doc)
    manifest = extract_payload(read_document_xml(doc_path))
    files = manifest.get("files", [])

    print("Applying update %s" % manifest.get("version", "?"))
    print("  Document : %s" % doc_path)
    print("  Target   : %s" % target_dir)
    print("  Files    : %d" % len(files))
    print("-" * 60)

    created = replaced = 0
    for f in files:
        action = write_file(target_dir, f["path"], f["content"])
        if action == "created":
            created += 1
        else:
            replaced += 1
        print("  [%s] %s" % (action.upper(), f["path"]))

    print("-" * 60)
    print("Done. %d created, %d replaced (%d .bak backups written)."
          % (created, replaced, replaced if MAKE_BACKUP else 0))
    print("\nNext steps:")
    print("  1) (optional) npm install    # no new dependencies, safe to skip")
    print("  2) git add -A && git commit -m \"2026 feature update\" && git push")
    print("  3) Render auto-deploys. Hard-refresh the browser (Ctrl+F5).")
    print("\nTo roll back: restore the *.bak files, or use Render -> Events -> Rollback.")


if __name__ == "__main__":
    main()