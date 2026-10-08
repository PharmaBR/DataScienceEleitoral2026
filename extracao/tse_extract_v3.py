#!/usr/bin/env python3
"""Build a compact data bundle of the Brazilian 2026 general election (TSE).

Run it on your own machine (Python 3.9+, standard library only):

    python tse_extract_v3.py
    python tse_extract_v3.py --perfil-zip ~/Downloads/perfil_eleitorado_2026.zip

It does two things and writes ``tse2026_dados_v3.zip``:

1. Voter profile  - reads ``perfil_eleitorado_2026.zip`` (downloaded if you
   do not pass ``--perfil-zip``) and sums the zone-level rows up to
   municipality level.
2. First round    - downloads the official presidential result of every
   municipality from resultados.tse.jus.br (one small JSON each, cached in
   ``tse_cache/`` so an interrupted run resumes).

Nothing is sent anywhere: the script only downloads from TSE and writes
local files.
"""
from __future__ import annotations

import argparse
import csv
import io
import itertools
import json
import sys
import time
import urllib.request
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

PERFIL_URL = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitorado/"
    "perfil_eleitorado_2026.zip"
)
RESULT_BASE = "https://resultados.tse.jus.br/oficial/ele2026"
ELECTION = 6257  # Eleição Geral Federal 2026, 1º turno
CARGO = 1  # Presidente
USER_AGENT = "Mozilla/5.0 (tse_extract.py; research use)"

# Profile dimensions kept in the bundle: name -> (code column, label column)
DIMENSIONS = {
    "genero": ("CD_GENERO", "DS_GENERO"),
    "faixa_etaria": ("CD_FAIXA_ETARIA", "DS_FAIXA_ETARIA"),
    "estado_civil": ("CD_ESTADO_CIVIL", "DS_ESTADO_CIVIL"),
    "escolaridade": ("CD_GRAU_ESCOLARIDADE", "DS_GRAU_ESCOLARIDADE"),
    "raca_cor": ("CD_RACA_COR", "DS_RACA_COR"),
    "identidade_genero": ("CD_IDENTIDADE_GENERO", "DS_IDENTIDADE_GENERO"),
    "quilombola": ("CD_QUILOMBOLA", "DS_QUILOMBOLA"),
}
# Cross-tabulations written per municipality
CROSSTABS = {
    "perfil_sexo_idade_civil": ("genero", "faixa_etaria", "estado_civil"),
    "perfil_sexo_idade_escolaridade": ("genero", "faixa_etaria", "escolaridade"),
    "perfil_sexo_raca": ("genero", "raca_cor"),
    "perfil_identidade_genero": ("identidade_genero",),
    "perfil_quilombola": ("quilombola",),
}
# Count columns. TSE renames these between years (2026: QT_ELEITORES and
# QT_ELEITORES_NOME_SOCIAL), so they are resolved from the header: three by
# keyword, and the voter count is a known name or else the largest QT_ column.
VOTER_COLUMNS = ("QT_ELEITORES", "QT_ELEITORES_PERFIL", "QT_ELEITOR")
COUNT_KEYWORDS = {"biometria": "BIOMETRIA", "deficiencia": "DEFICIENCIA", "nome_social": "SOCIAL"}
COUNT_NAMES = ("eleitores", *COUNT_KEYWORDS)
ID_PREFIXES = ("CD_", "DS_", "NM_", "SG_", "NR_", "DT_", "HH_", "ANO_", "AA_", "TP_")
MISSING = ("", "#NULO", "#NE")
SAMPLE_ROWS = 300_000
BUNDLE_NAME = "tse2026_dados_v3.zip"


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def to_int(value: object) -> int:
    """TSE numbers arrive as quoted strings; blanks and #NULO count as 0."""
    text = str(value or "").strip().replace(".", "")
    try:
        number = int(text)
    except ValueError:
        return 0
    return max(number, 0)  # -1 / -3 are TSE's "missing" markers


def http_get(url: str, retries: int = 4, timeout: int = 60) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except Exception as error:  # noqa: BLE001 - retry any network error
            last = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to download {url}: {last}")


def download_file(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(request, timeout=120) as response, tmp.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    tmp.replace(dest)
    return dest


# --------------------------------------------------------------------------
# Voter profile
# --------------------------------------------------------------------------
@dataclass
class ProfileAggregate:
    municipalities: dict[int, tuple[str, str]] = field(default_factory=dict)
    totals: dict[int, list[int]] = field(default_factory=dict)
    crosstabs: dict[str, Counter] = field(
        default_factory=lambda: {name: Counter() for name in CROSSTABS}
    )
    labels: dict[str, dict[str, str]] = field(
        default_factory=lambda: {name: {} for name in DIMENSIONS}
    )
    generated_at: str = ""
    rows: int = 0


def profile_members(names: Iterable[str]) -> list[str]:
    """CSV members to read. If TSE ships per-state files plus a national
    one, keep only the national file so nothing is counted twice."""
    csvs = [n for n in names if n.lower().endswith(".csv")]
    national = [n for n in csvs if "BRASIL" in n.upper()]
    return national if national and len(csvs) > 1 else csvs


def normalize_header(names: Iterable[str]) -> list[str]:
    return [name.strip().lstrip("\ufeff").strip('"').upper() for name in names]


def sample_count_columns(rows: Iterable[dict[str, str]]) -> dict[str, int]:
    """Sum of every column that holds only integers and is not an identifier."""
    sums: dict[str, int] = {}
    rejected: set[str] = set()
    for row in rows:
        for name, value in row.items():
            if name is None or name in rejected or name.startswith(ID_PREFIXES):
                continue
            text = (value or "").strip()
            if text in MISSING:
                sums.setdefault(name, 0)
            elif text.lstrip("-").isdigit():
                sums[name] = sums.get(name, 0) + max(int(text), 0)
            else:
                rejected.add(name)
                sums.pop(name, None)
    return sums


def resolve_count_columns(sample_sums: dict[str, int]) -> dict[str, str | None]:
    """Map each output count to the column that holds it in this year's file."""
    columns: dict[str, str | None] = {
        name: next((column for column in sample_sums if keyword in column), None)
        for name, keyword in COUNT_KEYWORDS.items()
    }
    taken = set(columns.values())
    remaining = {c: total for c, total in sample_sums.items() if c not in taken}
    known = [c for c in VOTER_COLUMNS if c in remaining]
    quantities = {c: total for c, total in remaining.items() if c.startswith("QT")}
    pool = quantities or remaining
    voters = known[0] if known else (max(pool, key=pool.get) if pool else None)
    return {"eleitores": voters, **columns}


def raw_profile_lines(zip_path: Path, count: int = 4) -> list[str]:
    """First lines of the profile CSV exactly as TSE wrote them."""
    with zipfile.ZipFile(zip_path) as archive:
        member = profile_members(archive.namelist())[0]
        with archive.open(member) as raw:
            return [raw.readline().decode("latin-1").rstrip("\r\n") for _ in range(count)]


def iter_profile_rows(zip_path: Path) -> Iterator[dict[str, str]]:
    with zipfile.ZipFile(zip_path) as archive:
        for member in profile_members(archive.namelist()):
            with archive.open(member) as raw:
                text = io.TextIOWrapper(raw, encoding="latin-1", newline="")
                reader = csv.reader(text, delimiter=";", quotechar='"')
                header = normalize_header(next(reader))
                for values in reader:
                    yield dict(zip(header, values))


def aggregate_profile(
    rows: Iterable[dict[str, str]], columns: dict[str, str | None]
) -> ProfileAggregate:
    agg = ProfileAggregate()
    for row in rows:
        agg.rows += 1
        if agg.rows % 1_000_000 == 0:
            print(f"  {agg.rows:,} profile rows read")
        if not agg.generated_at:
            agg.generated_at = f"{row.get('DT_GERACAO', '')} {row.get('HH_GERACAO', '')}".strip()
        mun = to_int(row["CD_MUNICIPIO"])
        agg.municipalities.setdefault(mun, (row["SG_UF"], row["NM_MUNICIPIO"]))

        counts = [to_int(row.get(columns[name])) if columns[name] else 0 for name in COUNT_NAMES]
        total = agg.totals.setdefault(mun, [0] * len(COUNT_NAMES))
        for index, value in enumerate(counts):
            total[index] += value

        codes: dict[str, str | None] = {}
        for name, (code_col, label_col) in DIMENSIONS.items():
            if code_col not in row:  # column absent in this year's layout
                codes[name] = None
                continue
            code = (row[code_col] or "").strip() or "NA"
            codes[name] = code
            if code not in agg.labels[name]:
                agg.labels[name][code] = (row.get(label_col) or "").strip()

        for name, dims in CROSSTABS.items():
            key = (mun, *(codes[d] for d in dims))
            if None not in key:
                agg.crosstabs[name][key] += counts[0]
    return agg


# --------------------------------------------------------------------------
# First-round results
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Municipality:
    uf: str
    cd_tse: str  # zero-padded, as used in TSE file names
    cd_ibge: str
    name: str
    capital: bool

    @property
    def result_url(self) -> str:
        uf = self.uf.lower()
        return (
            f"{RESULT_BASE}/{ELECTION}/dados/{uf}/"
            f"{uf}{self.cd_tse}-c{CARGO:04d}-e{ELECTION:06d}-u.json"
        )


def config_url() -> str:
    return f"{RESULT_BASE}/{ELECTION}/config/mun-e{ELECTION:06d}-cm.json"


def parse_municipality_config(config: dict) -> list[Municipality]:
    return [
        Municipality(
            uf=state["cd"].upper(),
            cd_tse=mun["cd"],
            cd_ibge=str(mun.get("cdi", "")),
            name=mun["nm"],
            capital=str(mun.get("c", "n")).lower() == "s",
        )
        for state in config.get("abr", [])
        for mun in state.get("mu", [])
    ]


def _walk_candidates(node: object, party: str = "") -> Iterator[tuple[str, dict]]:
    """Yield (party, candidate) wherever a ``cand`` list appears."""
    if isinstance(node, dict):
        if "cand" in node:
            party = node.get("sg", party)
            for candidate in node["cand"]:
                yield party, candidate
        for key, value in node.items():
            if key != "cand":
                yield from _walk_candidates(value, party)
    elif isinstance(node, list):
        for item in node:
            yield from _walk_candidates(item, party)


def parse_result(payload: dict) -> tuple[dict, list[dict]]:
    """Return (municipality summary, candidate rows) from one result file."""
    electorate, votes = payload.get("e", {}), payload.get("v", {})
    summary = {
        "eleitorado": to_int(electorate.get("te")),
        "comparecimento": to_int(electorate.get("c")),
        "abstencao": to_int(electorate.get("a")),
        "votos_totais": to_int(votes.get("tv")),
        "votos_validos": to_int(votes.get("vv")),
        "votos_brancos": to_int(votes.get("vb")),
        "votos_nulos": to_int(votes.get("tvn")),
        "totalizacao_final": payload.get("tf", ""),
        "gerado_em": f"{payload.get('dg', '')} {payload.get('hg', '')}".strip(),
    }
    candidates = [
        {
            "numero": cand.get("n", ""),
            "nome_urna": cand.get("nmu", cand.get("nm", "")),
            "partido": party,
            "votos": to_int(cand.get("vap")),
        }
        for party, cand in _walk_candidates(payload.get("carg", []))
    ]
    return summary, candidates


def fetch_results(
    municipalities: list[Municipality], cache_dir: Path, workers: int
) -> tuple[dict[Municipality, dict], list[str]]:
    cache_dir.mkdir(parents=True, exist_ok=True)

    def load(mun: Municipality) -> dict:
        cached = cache_dir / mun.result_url.rsplit("/", 1)[-1]
        if not cached.exists():
            cached.write_bytes(http_get(mun.result_url))
        return json.loads(cached.read_text(encoding="utf-8"))

    payloads: dict[Municipality, dict] = {}
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(load, mun): mun for mun in municipalities}
        for done, future in enumerate(as_completed(futures), start=1):
            mun = futures[future]
            try:
                payloads[mun] = future.result()
            except Exception as error:  # noqa: BLE001 - reported at the end
                failures.append(f"{mun.uf} {mun.name}: {error}")
            if done % 500 == 0 or done == len(futures):
                print(f"  {done:,}/{len(futures):,} municipalities")
    return payloads, failures


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
def write_csv(path: Path, header: list[str], rows: Iterable[Iterable[object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def write_profile(agg: ProfileAggregate, out: Path) -> None:
    write_csv(
        out / "perfil_totais.csv",
        ["cd_tse", "uf", "municipio", "eleitores", "biometria", "deficiencia", "nome_social"],
        ((mun, *agg.municipalities[mun], *agg.totals[mun]) for mun in sorted(agg.totals)),
    )
    for name, dims in CROSSTABS.items():
        table = agg.crosstabs[name]
        if table:
            write_csv(
                out / f"{name}.csv",
                ["cd_tse", *dims, "eleitores"],
                ((*key, count) for key, count in sorted(table.items())),
            )


def write_results(payloads: dict[Municipality, dict], out: Path) -> dict:
    summaries, candidates = [], []
    for mun, payload in sorted(payloads.items(), key=lambda item: (item[0].uf, item[0].cd_tse)):
        summary, cands = parse_result(payload)
        cd = int(mun.cd_tse)
        summaries.append([cd, mun.cd_ibge, mun.uf, mun.name, int(mun.capital), *summary.values()])
        candidates.extend([cd, c["numero"], c["nome_urna"], c["partido"], c["votos"]] for c in cands)
    write_csv(
        out / "resultado_municipios.csv",
        ["cd_tse", "cd_ibge", "uf", "municipio", "capital", "eleitorado", "comparecimento",
         "abstencao", "votos_totais", "votos_validos", "votos_brancos", "votos_nulos",
         "totalizacao_final", "gerado_em"],
        summaries,
    )
    write_csv(
        out / "resultado_candidatos.csv",
        ["cd_tse", "numero", "nome_urna", "partido", "votos"],
        candidates,
    )
    by_candidate: Counter = Counter()
    for _, _numero, nome, _partido, votos in candidates:
        by_candidate[nome] += votos
    return {
        "municipios": len(summaries),
        "votos_validos": sum(row[9] for row in summaries),
        "sem_totalizacao_final": sum(1 for row in summaries if row[12] != "s"),
        "candidatos": dict(by_candidate.most_common()),
    }


def make_bundle(out: Path, bundle: Path) -> None:
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(out.iterdir()):
            archive.write(path, path.name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--perfil-zip", type=Path, help="perfil_eleitorado_2026.zip already on disk")
    parser.add_argument("--out", type=Path, default=Path("tse2026_out"))
    parser.add_argument("--cache", type=Path, default=Path("tse_cache"))
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--skip-profile", action="store_true")
    parser.add_argument("--skip-results", action="store_true")
    args = parser.parse_args(argv)

    args.out.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    meta: dict = {"election": ELECTION, "cargo": CARGO, "created": time.strftime("%Y-%m-%d %H:%M:%S")}

    if not args.skip_profile:
        print("[1/2] voter profile")
        zip_path = args.perfil_zip or download_file(PERFIL_URL, args.cache / "perfil_eleitorado_2026.zip")
        head = list(itertools.islice(iter_profile_rows(zip_path), 5))
        sample_sums = sample_count_columns(itertools.islice(iter_profile_rows(zip_path), SAMPLE_ROWS))
        columns = resolve_count_columns(sample_sums)
        diagnostic = {
            "arquivos_no_zip": zipfile.ZipFile(zip_path).namelist(),
            "cabecalho": [str(name) for name in head[0]] if head else [],
            "linhas_brutas": raw_profile_lines(zip_path),
            "primeiras_linhas": [[str(v) for v in row.values()] for row in head],
            "somas_na_amostra": sample_sums,
            "colunas_escolhidas": columns,
        }
        (args.out / "diagnostico.json").write_text(
            json.dumps(diagnostic, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print(f"  count columns found: {columns}")
        agg = aggregate_profile(iter_profile_rows(zip_path), columns)
        write_profile(agg, args.out)
        (args.out / "rotulos.json").write_text(
            json.dumps(agg.labels, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        voters = sum(total[0] for total in agg.totals.values())
        if not voters:
            print("  WARNING: no voters counted - attach the zip anyway, it carries the diagnostic.")
        meta["perfil"] = {"linhas": agg.rows, "municipios": len(agg.totals),
                          "eleitores": voters, "gerado_em": agg.generated_at}
        print(f"  {agg.rows:,} rows -> {len(agg.totals):,} municipalities, {voters:,} voters")

    if not args.skip_results:
        print("[2/2] first-round presidential results")
        municipalities = parse_municipality_config(json.loads(http_get(config_url())))
        payloads, failures = fetch_results(municipalities, args.cache / "resultados", args.workers)
        stats = write_results(payloads, args.out)
        meta["resultado"] = {**stats, "falhas": failures}
        valid = stats["votos_validos"]
        print(f"  {stats['municipios']:,} municipalities, {valid:,} valid votes")
        for name, votes in list(stats["candidatos"].items())[:4]:
            share = 100 * votes / valid if valid else 0
            print(f"    {name:<28} {votes:>12,}  {share:5.2f}%")
        if not valid:
            print("  WARNING: every total is zero - TSE is serving pre-election files. "
                  "Delete tse_cache/resultados and run again later.")
        if failures:
            print(f"  WARNING: {len(failures)} municipalities failed; run again to retry them.")
        official = sum(parse_result(payload)[0]["eleitorado"] for payload in payloads.values())
        profile = meta.get("perfil", {}).get("eleitores")
        if profile is not None and official:
            ratio = profile / official
            meta["conferencia"] = {"eleitores_perfil": profile, "eleitorado_oficial": official,
                                   "razao": round(ratio, 4)}
            verdict = "OK" if 0.9 <= ratio <= 1.1 else "WARNING: these should be close"
            print(f"  check: profile {profile:,} voters vs official electorate {official:,} "
                  f"(ratio {ratio:.3f}) {verdict}")

    (args.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    bundle = Path(BUNDLE_NAME)
    make_bundle(args.out, bundle)
    print(f"done: {bundle.resolve()} ({bundle.stat().st_size / 1e6:.1f} MB)")
    print(f">>> attach this file to the chat: {BUNDLE_NAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
