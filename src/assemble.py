#!/usr/bin/env python3
"""Inline the library, the app and the data into the page.

usage: assemble.py DATA_JSON OUT_HTML [--site URL] [--repo URL] [--author NAME] [--d3 PATH] [--notices PATH]

--site, --repo and --author are optional and only feed the credits: the public
address of the page, the address of the source code and the name to cite.
The third-party notices travel inside the page, so the single file keeps them.
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).parent


def inline_json(text):
    """JSON that is safe inside a <script> element."""
    return text.replace("</", "<\\/")


def assemble(page, d3, app, data, site, notices=""):
    """Fill the placeholders one at a time, so inserted text is never scanned again."""
    if "</script" in notices.lower():
        raise SystemExit("the notices would close their own <script> element")
    for mark, text in (("__D3__", d3), ("__APP__", app), ("__NOTICES__", notices),
                       ("__SITE__", inline_json(json.dumps(site, ensure_ascii=False))),
                       ("__DATA__", inline_json(data))):
        before, found, after = page.partition(mark)
        if not found:
            raise SystemExit(f"placeholder {mark} is missing from the page")
        page = before + text + after
    return page


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("data"), parser.add_argument("out")
    parser.add_argument("--site", default=""), parser.add_argument("--repo", default="")
    parser.add_argument("--author", default="")
    parser.add_argument("--d3", default=str(HERE / "vendor" / "d3.min.js"))
    parser.add_argument("--notices", default=str(HERE / "vendor" / "NOTICES.txt"))
    args = parser.parse_args()
    read = lambda path: Path(path).read_text(encoding="utf-8")
    html = assemble(read(HERE / "page.src.html"), read(args.d3), read(HERE / "app.js"), read(args.data),
                    {"site": args.site, "repo": args.repo, "author": args.author}, read(args.notices))
    Path(args.out).write_text(html, encoding="utf-8")
    print(args.out, f"{len(html.encode()) / 1e6:.2f} MB")
