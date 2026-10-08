"""State outlines from municipal boundaries.

usage: make_states.py MUN_DIR OUT_GEOJSON

MUN_DIR holds the per-state files of tbrugz/geodata-br (geojs-<UF code>-mun.json,
source IBGE, CC0 1.0). Each state's municipalities are merged into one outline,
written with the property ``sigla`` that build_data.py expects.
"""
import json
import sys
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

UF_CODE = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
    "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
    "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
}
SLIVER = 1e-4  # degrees; closes hairline gaps between neighbouring municipalities


def outline(features):
    """One (multi)polygon without interior holes for a list of municipal features."""
    # a few source polygons are self-intersecting; repair them before merging
    merged = unary_union([make_valid(shape(f["geometry"])).buffer(SLIVER) for f in features]).buffer(-SLIVER)
    polygons = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
    return unary_union([type(p)(p.exterior) for p in polygons])


def build(mun_dir):
    features = []
    for code, uf in sorted(UF_CODE.items(), key=lambda item: item[1]):
        path = mun_dir / f"geojs-{code}-mun.json"
        municipalities = json.loads(path.read_text(encoding="utf-8-sig"))["features"]
        features.append({"type": "Feature", "properties": {"sigla": uf, "codigo_ibge": code,
                                                            "municipios": len(municipalities)},
                         "geometry": mapping(outline(municipalities))})
    return {"type": "FeatureCollection", "features": features}


if __name__ == "__main__":
    source, out = Path(sys.argv[1]), Path(sys.argv[2])
    collection = build(source)
    out.write_text(json.dumps(collection), encoding="utf-8")
    print(f"{out}: {len(collection['features'])} states, "
          f"{sum(f['properties']['municipios'] for f in collection['features'])} municipalities")
