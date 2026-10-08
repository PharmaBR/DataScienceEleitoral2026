#!/usr/bin/env python3
"""usage: assemble_site.py PAGE_HTML OUT_DIR - wrap the page as a complete index.html for any static host."""
import sys
from pathlib import Path
page = Path(sys.argv[1]).read_text(encoding="utf-8")
cut = page.index("</style>") + len("</style>")
head, body = page[:cut], page[cut:]
DESCRIPTION = ("Como cada município brasileiro votou para presidente em 2026 e 2022 e quem são seus eleitores: sexo, idade, "
               "estado civil e escolaridade. Um painel independente para explorar, com método, os dados oficiais do TSE.")
html = f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{DESCRIPTION}">
<meta property="og:title" content="Explorador do Eleitorado Brasileiro">
<meta property="og:description" content="{DESCRIPTION}">
<meta property="og:type" content="website">
<style>:root{{color-scheme:light}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
{head}
</head>
<body>{body}
</body>
</html>
"""
out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
(out / "index.html").write_text(html, encoding="utf-8")
print(out / "index.html", f"{len(html.encode()) / 1e6:.2f} MB")
