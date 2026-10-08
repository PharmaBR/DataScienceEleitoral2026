#!/usr/bin/env python3
"""Shape the TSE bundles into the compact payload the dashboard embeds.

usage: build_data.py BUNDLE_2026 REF_DIR STATES_GEOJSON OUT_JSON [BUNDLE_2022]

The 2026 bundle defines the list of municipalities; other years are aligned
to it by TSE municipality code.
"""
import base64
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import mapping, shape

REGION = {
    "N": ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
    "NE": ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "CO": ["DF", "GO", "MS", "MT"],
    "SE": ["ES", "MG", "RJ", "SP"],
    "S": ["PR", "RS", "SC"],
}
UF_REGION = {uf: region for region, ufs in REGION.items() for uf in ufs}
UF_NAME = {
    "AC": "Acre", "AL": "Alagoas", "AM": "Amazonas", "AP": "Amapá", "BA": "Bahia", "CE": "Ceará",
    "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão",
    "MG": "Minas Gerais", "MS": "Mato Grosso do Sul", "MT": "Mato Grosso", "PA": "Pará",
    "PB": "Paraíba", "PE": "Pernambuco", "PI": "Piauí", "PR": "Paraná", "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte", "RO": "Rondônia", "RR": "Roraima", "RS": "Rio Grande do Sul",
    "SC": "Santa Catarina", "SE": "Sergipe", "SP": "São Paulo", "TO": "Tocantins",
}
# TSE age-band code -> index of the dashboard's age band
AGE_LABELS = ["16–17", "18–20", "21–24", "25–29", "30–34", "35–39", "40–44", "45–49",
              "50–54", "55–59", "60–64", "65–69", "70–74", "75–79", "80+"]
AGE_MID = [16.5, 19, 22.5, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72, 77, 86]
AGE = {"1600": 0, "1700": 0, "1800": 1, "1900": 1, "2000": 1, "2124": 2, "2529": 3, "3034": 4,
       "3539": 5, "4044": 6, "4549": 7, "5054": 8, "5559": 9, "6064": 10, "6569": 11,
       "7074": 12, "7579": 13, "8084": 14, "8589": 14, "9094": 14, "9599": 14, "9999": 14}
SEX = {"4": 0, "2": 1}  # women, men
MARITAL = {"1": 0, "3": 1, "7": 2, "9": 2, "5": 3}   # single, married, divorced or separated, widowed
SCHOOL = {"1": 0, "2": 0, "3": 1, "4": 1, "5": 2, "6": 2, "7": 3, "8": 3}   # none, primary, secondary, higher
RACE = {"1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "-1": 5}
KM = KS = 4
KR = 6
# (ballot number, key in the payload, name, short name). "a" is always the main opponent of Lula.
CANDIDATES = {
    "2026": [("22", "a", "Flávio Bolsonaro", "Flávio"), ("13", "lu", "Lula", "Lula"), ("70", "c3", "Augusto Cury", "Cury"),
             ("14", "c4", "Renan Santos", "Renan"), ("55", "c5", "Ronaldo Caiado", "Caiado")],
    "2022": [("22", "a", "Jair Bolsonaro", "Bolsonaro"), ("13", "lu", "Lula", "Lula"), ("15", "c3", "Simone Tebet", "Tebet"),
             ("12", "c4", "Ciro Gomes", "Ciro")],
}
PARTICLES = {"De", "Da", "Do", "Das", "Dos", "E", "Em", "Na", "No"}


def title_pt(name):
    words = name.title().split(" ")
    return " ".join(w.lower() if i and w in PARTICLES else w for i, w in enumerate(words)).replace("D'a", "d'A").replace("D'o", "d'O")


def pack(values):
    """Unsigned LEB128 varints, base64 - about half the size of a JSON array."""
    out = bytearray()
    for value in values:
        value = int(value)
        while True:
            byte = value & 0x7F
            value >>= 7
            out.append(byte | (0x80 if value else 0))
            if not value:
                break
    return base64.b64encode(bytes(out)).decode("ascii")


def read(path):
    with open(path, encoding="utf-8", newline="") as handle:
        yield from csv.DictReader(handle)


def state_shapes(path, tolerance=0.04):
    shapes = []
    for feature in json.load(open(path, encoding="utf-8"))["features"]:
        uf = feature["properties"]["sigla"]
        geometry = mapping(shape(feature["geometry"]).simplify(tolerance, preserve_topology=True))
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        rings = [[[round(x, 2), round(y, 2)] for x, y in polygon[0]] for polygon in polygons]
        rings = [ring for ring in rings if len(ring) >= 6] or rings[:1]
        shapes.append({"uf": uf, "name": UF_NAME[uf], "region": UF_REGION[uf], "rings": rings})
    return sorted(shapes, key=lambda s: s["uf"])


def municipalities(bundle, ref):
    """The fixed list of municipalities, from the 2026 results."""
    coords = {row["codigo_ibge"]: (float(row["latitude"]), float(row["longitude"]))
              for row in read(ref / "municipios.csv")}
    domestic = [row for row in read(bundle / "resultado_municipios.csv") if row["uf"] in UF_REGION]
    domestic.sort(key=lambda row: (row["uf"], row["municipio"]))
    ufs = sorted(UF_REGION)
    by_uf = defaultdict(list)
    for row in domestic:
        if row["cd_ibge"] in coords:
            by_uf[row["uf"]].append(coords[row["cd_ibge"]])

    def position(row):
        if row["cd_ibge"] in coords:
            return coords[row["cd_ibge"]]
        points = by_uf[row["uf"]]  # new municipality: fall back to its state's centre
        return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))

    mun = {
        "ibge": [int(row["cd_ibge"] or 0) for row in domestic],
        "name": [title_pt(row["municipio"]) for row in domestic],
        "uf": [ufs.index(row["uf"]) for row in domestic],
        "cap": [int(row["capital"]) for row in domestic],
        "lat": [round(position(row)[0], 3) for row in domestic],
        "lon": [round(position(row)[1], 3) for row in domestic],
    }
    index = {int(row["cd_tse"]): i for i, row in enumerate(domestic)}
    missing = [row["municipio"] for row in domestic if row["cd_ibge"] not in coords]
    return mun, index, ufs, missing


def year_block(bundle, index, year):
    """Packed per-municipality arrays for one election year, plus its national totals and checks."""
    n, A = len(index), len(AGE_LABELS)
    results = list(read(bundle / "resultado_municipios.csv"))
    abroad = [row for row in results if row["uf"] not in UF_REGION]
    votes = defaultdict(lambda: defaultdict(int))
    parties = {}
    for row in read(bundle / "resultado_candidatos.csv"):
        votes[int(row["cd_tse"])][row["numero"]] += int(row["votos"])
        parties.setdefault(row["numero"], row["partido"])

    def column(rows, name, source):
        flat = [0] * n
        for row in rows:
            i = index.get(int(row["cd_tse"]))
            if i is not None:
                flat[i] += int(row[source] or 0)
        return flat

    arrays, matched = {}, sum(1 for row in results if int(row["cd_tse"]) in index)
    for key, source in [("el", "eleitorado"), ("comp", "comparecimento"), ("valid", "votos_validos"),
                        ("blank", "votos_brancos"), ("nul", "votos_nulos")]:
        arrays[key] = column(results, key, source)
    for number, key, _, _ in CANDIDATES[year]:
        flat = [0] * n
        for cd, by_number in votes.items():
            if cd in index:
                flat[index[cd]] = by_number.get(number, 0)
        arrays[key] = flat

    totals = list(read(bundle / "perfil_totais.csv"))
    arrays["pel"] = column(totals, "pel", "eleitores")
    arrays["bio"] = column(totals, "bio", "biometria")

    dropped = {}

    def cube(filename, name, codes, size):
        flat, lost = [0] * (n * 2 * A * size), 0
        for row in read(bundle / filename):
            i = index.get(int(row["cd_tse"]))
            if i is None:
                continue
            count = int(row["eleitores"])
            s, a, k = SEX.get(row["genero"]), AGE.get(row["faixa_etaria"]), codes.get(row[name])
            if s is None or a is None or k is None:
                lost += count
                continue
            flat[((i * 2 + s) * A + a) * size + k] += count
        dropped[filename] = lost
        return flat

    arrays["cm"] = cube("perfil_sexo_idade_civil.csv", "estado_civil", MARITAL, KM)
    arrays["cs"] = cube("perfil_sexo_idade_escolaridade.csv", "escolaridade", SCHOOL, KS)
    declared = None
    if (bundle / "perfil_sexo_raca.csv").exists():
        race = [0] * KR
        for row in read(bundle / "perfil_sexo_raca.csv"):
            if int(row["cd_tse"]) in index and row["raca_cor"] in RACE:
                race[RACE[row["raca_cor"]]] += int(row["eleitores"])
        declared = round(100 * sum(race[:5]) / max(1, sum(race)), 1)

    def total(rows, name):
        return sum(int(row[name] or 0) for row in rows)

    national_votes = defaultdict(int)  # every place, voters abroad included
    for by_number in votes.values():
        for number, count in by_number.items():
            national_votes[number] += count
    bundle_meta = json.load(open(bundle / "meta.json", encoding="utf-8"))
    meta = {
        "profile_date": bundle_meta["perfil"]["gerado_em"],
        "result_date": max(row["gerado_em"] for row in results),
        "national": {"el": total(results, "eleitorado"), "comp": total(results, "comparecimento"),
                     "valid": total(results, "votos_validos"), "blank": total(results, "votos_brancos"),
                     "nul": total(results, "votos_nulos"),
                     "cands": {key: national_votes[number] for number, key, _, _ in CANDIDATES[year]}},
        "abroad": {"places": len(abroad), "el": total(abroad, "eleitorado")},
        "cands": [{"key": key, "name": name, "short": short, "party": parties.get(number, "")}
                  for number, key, name, short in CANDIDATES[year]],
        "race_declared": declared,
    }
    checks = {
        "places_in_bundle": len(results), "matched_to_2026_list": matched, "abroad_places": len(abroad),
        "without_data": n - sum(1 for v in arrays["el"] if v),
        "official_electorate_domestic": sum(arrays["el"]), "profile_electorate_domestic": sum(arrays["pel"]),
        "marital_cube_total": sum(arrays["cm"]), "school_cube_total": sum(arrays["cs"]), "dropped_from_cubes": dropped,
        "national_shares": {key: round(100 * count / max(1, meta["national"]["valid"]), 2) for key, count in meta["national"]["cands"].items()},
        "turnout": round(100 * meta["national"]["comp"] / max(1, meta["national"]["el"]), 2),
    }
    return {key: pack(values) for key, values in arrays.items()}, meta, checks


def build(bundles, ref, geo):
    mun, index, ufs, missing = municipalities(bundles["2026"], ref)
    payload = {
        "meta": {"years": sorted(bundles, reverse=True), "y": {}},
        "dims": {"age": AGE_LABELS, "age_mid": AGE_MID, "ufs": ufs, "uf_name": [UF_NAME[uf] for uf in ufs],
                 "uf_region": [UF_REGION[uf] for uf in ufs], "km": KM, "ks": KS},
        "states": state_shapes(geo), "n": len(index), "mun": mun, "years": {},
    }
    checks = {"municipalities": len(index), "missing_coords": missing}
    for year, bundle in bundles.items():
        payload["years"][year], payload["meta"]["y"][year], checks[year] = year_block(bundle, index, year)
    return payload, checks


if __name__ == "__main__":
    bundle, ref, geo, out = map(Path, sys.argv[1:5])
    bundles = {"2026": bundle}
    if len(sys.argv) > 5:
        bundles["2022"] = Path(sys.argv[5])
    payload, checks = build(bundles, ref, geo)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    print(json.dumps(checks, ensure_ascii=False, indent=1))
    print(f"{out} {len(text.encode('utf-8')) / 1e6:.2f} MB")
