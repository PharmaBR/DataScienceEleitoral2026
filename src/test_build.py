"""Tests for the page build - run with: python -m pytest test_build.py"""
import json

import pytest
from shapely.geometry import Polygon, mapping, shape

import assemble
import build_data
import make_states


def feature(points):
    return {"type": "Feature", "properties": {}, "geometry": mapping(Polygon(points))}


def square(x, y, size=1.0):
    return feature([(x, y), (x + size, y), (x + size, y + size), (x, y + size)])


def test_neighbouring_municipalities_merge_into_one_outline():
    merged = make_states.outline([square(0, 0), square(1, 0), square(0, 1), square(1, 1)])

    assert merged.geom_type == "Polygon"
    assert merged.area == pytest.approx(4.0, abs=1e-3)


def test_hairline_gaps_and_enclaves_do_not_leave_holes():
    ring = [square(x, y) for x in range(3) for y in range(3) if (x, y) != (1, 1)]  # hole in the middle
    apart = [square(0, 0), square(1.00005, 0)]                                    # hairline gap

    assert make_states.outline(ring).area == pytest.approx(9.0, abs=1e-3)
    assert make_states.outline(apart).geom_type == "Polygon"


def test_islands_stay_separate():
    merged = make_states.outline([square(0, 0), square(5, 5)])

    assert merged.geom_type == "MultiPolygon" and len(merged.geoms) == 2


def test_self_intersecting_source_polygon_is_repaired():
    bow_tie = {"type": "Feature", "properties": {}, "geometry": {
        "type": "Polygon", "coordinates": [[(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)]]}}
    assert not shape(bow_tie["geometry"]).is_valid

    merged = make_states.outline([bow_tie, square(1, 0)])

    assert merged.is_valid and merged.area == pytest.approx(1.5, abs=1e-3)


def test_states_are_keyed_by_sigla(tmp_path):
    for code in make_states.UF_CODE:
        collection = {"type": "FeatureCollection", "features": [square(int(code), 0)]}
        (tmp_path / f"geojs-{code}-mun.json").write_text("﻿" + json.dumps(collection), encoding="utf-8")

    states = make_states.build(tmp_path)["features"]

    assert [s["properties"]["sigla"] for s in states] == sorted(make_states.UF_CODE.values())
    assert len(states) == 27


PAGE = ("<script>__D3__</script><script type=t>__NOTICES__</script><script type=j>__SITE__</script>"
        "<script type=j>__DATA__</script><script>__APP__</script>")


def test_assemble_fills_every_placeholder_once():
    html = assemble.assemble(PAGE, "d3()", "app()", '{"n":1}', {"site": "https://x.test/", "repo": "", "author": "A"})

    assert "__" not in html
    assert '<script>d3()</script>' in html and '<script>app()</script>' in html
    assert json.loads(html.split("<script type=j>")[1].split("</script>")[0])["site"] == "https://x.test/"


def test_assemble_never_rescans_inserted_text():
    html = assemble.assemble(PAGE, "d3()", "app()", '{"name":"__APP__ </script>"}', {})

    assert html.count("app()") == 1
    assert '{"name":"__APP__ <\\/script>"}' in html


def test_assemble_refuses_a_page_without_placeholders():
    with pytest.raises(SystemExit, match="__SITE__"):
        assemble.assemble(PAGE.replace("__SITE__", ""), "", "", "{}", {})


def test_notices_travel_inside_the_page():
    html = assemble.assemble(PAGE, "", "", "{}", {}, "Copyright 2016 Someone")

    assert "<script type=t>Copyright 2016 Someone</script>" in html


def test_notices_cannot_close_their_own_element():
    with pytest.raises(SystemExit, match="notices"):
        assemble.assemble(PAGE, "", "", "{}", {}, "text </SCRIPT> more")


def test_latest_stamp_compares_dates_not_strings():
    assert build_data.latest(["30/09/2026 23:00:00", "02/10/2026 08:00:00"]) == "02/10/2026 08:00:00"
    assert build_data.latest(["05/10/2026 12:53:07", "05/10/2026 09:00:00", ""]) == "05/10/2026 12:53:07"
    assert build_data.latest(["07/10/2026", "31/12/2025"]) == "07/10/2026"
    assert build_data.latest([]) == ""
