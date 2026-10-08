#!/usr/bin/env python3
"""Build a compact data bundle of the Brazilian 2022 general election (TSE).

Run it on your own machine (Python 3.9+, standard library only):

    python tse_extract_2022.py

It downloads three files from the TSE open-data portal into ``tse_cache/``
(about 400 MB in total, kept so a second run does not download again):

1. perfil_eleitorado_2022.zip         - voter profile, summed to municipality
2. votacao_candidato_munzona_2022.zip - votes for president, both rounds
3. detalhe_votacao_munzona_2022.zip   - electorate, turnout, blank and null

and writes ``tse2022_dados.zip``. Attach that file to the chat.
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
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

YEAR = 2022
BASE = "https://cdn.tse.jus.br/estatistica/sead/odsele"
URLS = {
    "perfil": f"{BASE}/perfil_eleitorado/perfil_eleitorado_{YEAR}.zip",
    "votos": f"{BASE}/votacao_candidato_munzona/votacao_candidato_munzona_{YEAR}.zip",
    "detalhe": f"{BASE}/detalhe_votacao_munzona/detalhe_votacao_munzona_{YEAR}.zip",
}
USER_AGENT = "Mozilla/5.0 (tse_extract_2022.py; research use)"
BUNDLE_NAME = "tse2022_dados.zip"
# Official national totals (TSE), used only to check the extraction
OFFICIAL = {1: {"13": 57_259_504, "22": 51_072_345}, 2: {"13": 60_345_999, "22": 58_206_354}}

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


def make_bundle(out: Path, bundle: Path) -> None:
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(out.iterdir()):
            archive.write(path, path.name)



# --------------------------------------------------------------------------
# Results from the open-data CSV files
# --------------------------------------------------------------------------
def member_plans(names: Iterable[str]) -> list[list[str]]:
    """Which CSV members to read, in order of preference. TSE ships one file
    per state plus a presidential file (_BR) and sometimes everything in one
    (_BRASIL); reading more than one of those would count votes twice."""
    csvs = [n for n in names if n.lower().endswith(".csv")]
    stem = lambda n: n.upper().rsplit(".", 1)[0]
    br = [n for n in csvs if stem(n).endswith("_BR")]
    brasil = [n for n in csvs if stem(n).endswith("_BRASIL")]
    states = [n for n in csvs if n not in br and n not in brasil]
    plans = [plan for plan in (br, brasil, states + br) if plan]
    return plans or [csvs]


def iter_members(zip_path: Path, members: Iterable[str]) -> Iterator[dict[str, str]]:
    with zipfile.ZipFile(zip_path) as archive:
        for member in members:
            with archive.open(member) as raw:
                text = io.TextIOWrapper(raw, encoding="latin-1", newline="")
                reader = csv.reader(text, delimiter=";", quotechar='"')
                header = normalize_header(next(reader))
                for values in reader:
                    yield dict(zip(header, values))


def raw_lines(zip_path: Path, member: str, count: int = 3) -> list[str]:
    with zipfile.ZipFile(zip_path) as archive, archive.open(member) as raw:
        return [raw.readline().decode("latin-1").rstrip("\r\n") for _ in range(count)]


def pick(header: Iterable[str], exact: Iterable[str] = (), contains: Iterable[str] = ()) -> str | None:
    """First column that matches an exact name, else the first that contains a keyword."""
    names = list(header)
    for name in exact:
        if name in names:
            return name
    for keyword in contains:
        for name in names:
            if keyword in name:
                return name
    return None


def vote_columns(header: Iterable[str]) -> dict[str, str | None]:
    h = list(header)
    return {
        "turno": pick(h, ["NR_TURNO"], ["TURNO"]),
        "uf": pick(h, ["SG_UF"]),
        "municipio": pick(h, ["CD_MUNICIPIO"]),
        "nome_municipio": pick(h, ["NM_MUNICIPIO"]),
        "cargo": pick(h, ["DS_CARGO", "CD_CARGO"], ["CARGO"]),
        "numero": pick(h, ["NR_CANDIDATO"], ["NR_CAND", "NR_VOTAVEL"]),
        "nome": pick(h, ["NM_URNA_CANDIDATO"], ["NM_URNA", "NM_CANDIDATO", "NM_VOTAVEL"]),
        "partido": pick(h, ["SG_PARTIDO"]),
        "votos": pick(h, ["QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS"], ["QT_VOTOS"]),
        "gerado": pick(h, ["DT_GERACAO"]),
    }


def detail_columns(header: Iterable[str]) -> dict[str, str | None]:
    h = list(header)
    return {
        "turno": pick(h, ["NR_TURNO"], ["TURNO"]),
        "uf": pick(h, ["SG_UF"]),
        "municipio": pick(h, ["CD_MUNICIPIO"]),
        "nome_municipio": pick(h, ["NM_MUNICIPIO"]),
        "cargo": pick(h, ["DS_CARGO", "CD_CARGO"], ["CARGO"]),
        "eleitorado": pick(h, ["QT_APTOS"], ["APTOS"]),
        "comparecimento": pick(h, ["QT_COMPARECIMENTO"], ["COMPARECIMENTO"]),
        "abstencao": pick(h, ["QT_ABSTENCOES"], ["ABSTENC"]),
        "brancos": pick(h, ["QT_VOTOS_BRANCOS"], ["BRANCOS"]),
        "nulos": pick(h, ["QT_TOTAL_VOTOS_NULOS", "QT_VOTOS_NULOS"], ["NULOS"]),
    }


def is_president(row: dict[str, str], cargo_column: str | None) -> bool:
    value = (row.get(cargo_column) or "").strip().upper() if cargo_column else ""
    return value in ("PRESIDENTE", "1")


def read_votes(rows: Iterable[dict[str, str]], columns: dict[str, str | None]) -> dict:
    """votes[turno][cd_municipio][numero] plus names of places and candidates."""
    votes: dict = defaultdict(lambda: defaultdict(Counter))
    places: dict[int, tuple[str, str]] = {}
    candidates: dict[str, tuple[str, str]] = {}
    generated, kept, seen = "", 0, 0
    for row in rows:
        seen += 1
        if seen % 1_000_000 == 0:
            print(f"  {seen:,} vote rows read")
        if not is_president(row, columns["cargo"]):
            continue
        kept += 1
        mun, numero = to_int(row[columns["municipio"]]), (row[columns["numero"]] or "").strip()
        votes[to_int(row[columns["turno"]])][mun][numero] += to_int(row[columns["votos"]])
        places.setdefault(mun, (row.get(columns["uf"] or "", ""), row.get(columns["nome_municipio"] or "", "")))
        candidates.setdefault(numero, (row.get(columns["nome"] or "", ""), row.get(columns["partido"] or "", "")))
        generated = generated or row.get(columns["gerado"] or "", "")
    return {"votes": votes, "places": places, "candidates": candidates, "generated": generated, "rows": seen, "kept": kept}


def read_details(rows: Iterable[dict[str, str]], columns: dict[str, str | None]) -> dict:
    """detail[turno][cd_municipio] = [eleitorado, comparecimento, abstencao, brancos, nulos]."""
    fields = ("eleitorado", "comparecimento", "abstencao", "brancos", "nulos")
    detail: dict = defaultdict(lambda: defaultdict(lambda: [0] * len(fields)))
    places: dict[int, tuple[str, str]] = {}
    kept = seen = 0
    for row in rows:
        seen += 1
        if not is_president(row, columns["cargo"]):
            continue
        kept += 1
        mun = to_int(row[columns["municipio"]])
        bucket = detail[to_int(row[columns["turno"]])][mun]
        for index, name in enumerate(fields):
            if columns[name]:
                bucket[index] += to_int(row.get(columns[name]))
        places.setdefault(mun, (row.get(columns["uf"] or "", ""), row.get(columns["nome_municipio"] or "", "")))
    return {"detail": detail, "places": places, "rows": seen, "kept": kept}


def load_with_plans(zip_path: Path, columns_of, reader, required: Iterable[str], diagnostic: dict) -> dict | None:
    """Try each member plan until one yields presidential rows."""
    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
    diagnostic["arquivos_no_zip"] = names[:80]
    diagnostic["tentativas"] = []
    for members in member_plans(names):
        header = normalize_header(raw_lines(zip_path, members[0], 1)[0].split(";"))
        columns = columns_of(header)
        attempt = {"membros": members[:40], "cabecalho": header, "linhas_brutas": raw_lines(zip_path, members[0]),
                   "colunas_escolhidas": columns}
        diagnostic["tentativas"].append(attempt)
        missing = [name for name in required if not columns.get(name)]
        if missing:
            attempt["faltando"] = missing
            continue
        result = reader(iter_members(zip_path, members), columns)
        attempt["linhas"], attempt["linhas_presidente"] = result["rows"], result["kept"]
        if result["kept"]:
            return result
    return None


def write_round(turno: int, votes: dict | None, details: dict | None, out: Path) -> dict:
    """One pair of CSVs per round, same layout as the 2026 bundle."""
    suffix = "" if turno == 1 else f"_t{turno}"
    by_mun = votes["votes"].get(turno, {}) if votes else {}
    detail = details["detail"].get(turno, {}) if details else {}
    places = {**(details["places"] if details else {}), **(votes["places"] if votes else {})}
    summary, candidate_rows = [], []
    for mun in sorted(set(by_mun) | set(detail)):
        uf, name = places.get(mun, ("", ""))
        el, comp, abst, blank, null = detail.get(mun, [0, 0, 0, 0, 0])
        valid = sum(by_mun.get(mun, {}).values())
        summary.append([mun, "", uf, name, 0, el, comp, abst, comp, valid, blank, null, "s", votes["generated"] if votes else ""])
        for numero, count in sorted(by_mun.get(mun, {}).items()):
            nome, partido = votes["candidates"].get(numero, ("", ""))
            candidate_rows.append([mun, numero, nome, partido, count])
    write_csv(out / f"resultado_municipios{suffix}.csv",
              ["cd_tse", "cd_ibge", "uf", "municipio", "capital", "eleitorado", "comparecimento", "abstencao",
               "votos_totais", "votos_validos", "votos_brancos", "votos_nulos", "totalizacao_final", "gerado_em"], summary)
    write_csv(out / f"resultado_candidatos{suffix}.csv", ["cd_tse", "numero", "nome_urna", "partido", "votos"], candidate_rows)
    national = Counter()
    for row in candidate_rows:
        national[row[1]] += row[4]
    names = {numero: nome for numero, (nome, _) in (votes["candidates"].items() if votes else [])}
    checks = {numero: {"extraido": national.get(numero, 0), "oficial": official,
                       "razao": round(national.get(numero, 0) / official, 5)}
              for numero, official in OFFICIAL.get(turno, {}).items()}
    return {
        "municipios": len(summary), "votos_validos": sum(row[9] for row in summary),
        "eleitorado": sum(row[5] for row in summary), "comparecimento": sum(row[6] for row in summary),
        "brancos": sum(row[10] for row in summary), "nulos": sum(row[11] for row in summary),
        "candidatos": {names.get(numero, numero): count for numero, count in national.most_common()},
        "conferencia": checks,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    for name in URLS:
        parser.add_argument(f"--{name}-zip", type=Path, help=f"{Path(URLS[name]).name} already on disk")
    parser.add_argument("--out", type=Path, default=Path("tse2022_out"))
    parser.add_argument("--cache", type=Path, default=Path("tse_cache"))
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    meta: dict = {"year": YEAR, "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    diagnostic: dict = {"perfil": {}, "votos": {}, "detalhe": {}}
    local = lambda name: getattr(args, f"{name}_zip") or download_file(URLS[name], args.cache / Path(URLS[name]).name)

    def step(label: str, work) -> None:   # one failing file must not lose the others
        print(label)
        try:
            work()
        except Exception as error:  # noqa: BLE001 - recorded and reported, the bundle is still written
            diagnostic.setdefault("erros", []).append(f"{label}: {type(error).__name__}: {error}")
            print(f"  WARNING: {type(error).__name__}: {error}")

    def profile() -> None:
        zip_path = local("perfil")
        head = list(itertools.islice(iter_profile_rows(zip_path), 5))
        sums = sample_count_columns(itertools.islice(iter_profile_rows(zip_path), SAMPLE_ROWS))
        columns = resolve_count_columns(sums)
        diagnostic["perfil"] = {"arquivos_no_zip": zipfile.ZipFile(zip_path).namelist()[:80],
                                "cabecalho": [str(n) for n in head[0]] if head else [],
                                "linhas_brutas": raw_profile_lines(zip_path), "somas_na_amostra": sums,
                                "colunas_escolhidas": columns}
        print(f"  count columns found: {columns}")
        agg = aggregate_profile(iter_profile_rows(zip_path), columns)
        write_profile(agg, args.out)
        (args.out / "rotulos.json").write_text(json.dumps(agg.labels, ensure_ascii=False, indent=1), encoding="utf-8")
        voters = sum(total[0] for total in agg.totals.values())
        meta["perfil"] = {"linhas": agg.rows, "municipios": len(agg.totals), "eleitores": voters, "gerado_em": agg.generated_at}
        print(f"  {agg.rows:,} rows -> {len(agg.totals):,} municipalities, {voters:,} voters")

    loaded: dict = {}

    def votes() -> None:
        loaded["votos"] = load_with_plans(local("votos"), vote_columns, read_votes,
                                          ("turno", "municipio", "cargo", "numero", "votos"), diagnostic["votos"])
        if not loaded["votos"]:
            print("  WARNING: no presidential rows found - attach the zip anyway, it carries the diagnostic.")

    def details() -> None:
        loaded["detalhe"] = load_with_plans(local("detalhe"), detail_columns, read_details,
                                            ("turno", "municipio", "cargo", "eleitorado", "comparecimento"), diagnostic["detalhe"])
        if not loaded["detalhe"]:
            print("  WARNING: no presidential rows found - attach the zip anyway, it carries the diagnostic.")

    step("[1/3] voter profile 2022", profile)
    step("[2/3] votes for president 2022", votes)
    step("[3/3] electorate, turnout, blank and null 2022", details)

    meta["resultado"] = {}
    for turno in (1, 2):
        stats = write_round(turno, loaded.get("votos"), loaded.get("detalhe"), args.out)
        meta["resultado"][str(turno)] = stats
        print(f"  round {turno}: {stats['municipios']:,} places, {stats['votos_validos']:,} valid votes, "
              f"{stats['eleitorado']:,} voters, {stats['comparecimento']:,} turned out")
        for numero, check in stats["conferencia"].items():
            verdict = "OK" if abs(check["razao"] - 1) < 0.001 else "WARNING: differs from the official total"
            print(f"    candidate {numero}: {check['extraido']:,} vs official {check['oficial']:,} "
                  f"(ratio {check['razao']:.4f}) {verdict}")
    (args.out / "diagnostico.json").write_text(json.dumps(diagnostic, ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    bundle = Path(BUNDLE_NAME)
    make_bundle(args.out, bundle)
    print(f"done: {bundle.resolve()} ({bundle.stat().st_size / 1e6:.1f} MB)")
    print(f">>> attach this file to the chat: {BUNDLE_NAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
