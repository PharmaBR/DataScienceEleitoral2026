#!/usr/bin/env python3
"""usage: assemble.py DATA_JSON OUT_HTML - inline the app and the data into the page."""
import sys
from pathlib import Path
here = Path(__file__).parent
data = Path(sys.argv[1]).read_text(encoding="utf-8").replace("</", "<\\/")
page = (here / "page.src.html").read_text(encoding="utf-8")
page = page.replace("__APP__", (here / "app.js").read_text(encoding="utf-8")).replace("__DATA__", data)
Path(sys.argv[2]).write_text(page, encoding="utf-8")
print(sys.argv[2], f"{len(page.encode()) / 1e6:.2f} MB")
