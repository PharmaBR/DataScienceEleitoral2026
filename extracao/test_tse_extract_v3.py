"""Tests for tse_extract.py - run with: python -m pytest test_tse_extract_v3.py

Fixtures follow the TSE layouts: the voter-profile columns come from the
official leiame.pdf, the result JSON keys from a real 2026 municipality file.
"""
import csv
import io
import json
import zipfile

import pytest

import tse_extract_v3 as tse

HEADER = [
    "DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "SG_UF", "CD_MUNICIPIO", "NM_MUNICIPIO",
    "NR_ZONA", "CD_GENERO", "DS_GENERO", "CD_ESTADO_CIVIL", "DS_ESTADO_CIVIL",
    "CD_FAIXA_ETARIA", "DS_FAIXA_ETARIA", "CD_GRAU_ESCOLARIDADE", "DS_GRAU_ESCOLARIDADE",
    "CD_RACA_COR", "DS_RACA_COR", "CD_IDENTIDADE_GENERO", "DS_IDENTIDADE_GENERO",
    "CD_QUILOMBOLA", "DS_QUILOMBOLA", "CD_INTERPRETE_LIBRAS", "DS_INTERPRETE_LIBRAS",
    "QT_ELEITORES_PERFIL", "QT_ELEITORES_BIOMETRIA", "QT_ELEITORES_DEFICIENCIA",
    "QT_ELEITORES_INC_NM_SOCIAL",
]


def profile_row(mun, name, zone, genero, civil, faixa, qt, bio=0, defic=0, social=0, uf="AC"):
    genders = {"2": "MASCULINO", "4": "FEMININO"}
    civils = {"1": "SOLTEIRO", "3": "CASADO"}
    faixas = {"2529": "25 a 29 anos", "6064": "60 a 64 anos"}
    return [
        "20/07/2026", "09:21:00", "2026", uf, mun, name, zone, genero, genders[genero],
        civil, civils[civil], faixa, faixas[faixa], "6", "ENSINO MÉDIO COMPLETO",
        "3", "PARDA", "1", "CISGÊNERO", "2", "NÃO", "2", "NÃO",
        str(qt), str(bio), str(defic), str(social),
    ]


@pytest.fixture
def profile_zip(tmp_path, request):
    rows = [
        profile_row("1120", "ACRELÂNDIA", "8", "4", "1", "2529", 100, bio=90, defic=2),
        profile_row("1120", "ACRELÂNDIA", "9", "4", "1", "2529", 50, bio=40, social=1),
        profile_row("1120", "ACRELÂNDIA", "8", "2", "3", "6064", 30, bio=30),
        profile_row("1570", "ASSIS BRASIL", "6", "2", "1", "2529", 7, bio=-1),
    ]
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_ALL)
    writer.writerow(request.param if hasattr(request, "param") else HEADER)
    writer.writerows(rows)
    path = tmp_path / "perfil_eleitorado_2026.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("perfil_eleitorado_2026.csv", buffer.getvalue().encode("latin-1"))
        archive.writestr("leiame.pdf", b"%PDF")
    return path


def aggregate(zip_path):
    rows = list(tse.iter_profile_rows(zip_path))
    columns = tse.resolve_count_columns(tse.sample_count_columns(rows))
    return tse.aggregate_profile(rows, columns)


RESULT = {
    "ele": "6257", "tpabr": "mu", "cdabr": "01120", "dg": "05/10/2026", "hg": "01:12:40", "tf": "s",
    "carg": [{
        "cd": "1", "nmn": "Presidente",
        "fed": [{"n": "101", "sg": "PT/PC do B/PV", "npar": ["13", "43", "65"]}],
        "agr": [
            {"n": "1", "nm": "PARTIDO LIBERAL", "tp": "i", "par": [{
                "n": "22", "sg": "PL",
                "cand": [{"n": "22", "nm": "FLAVIO NANTES BOLSONARO", "nmu": "FLAVIO BOLSONARO",
                          "vap": "4321", "pvap": "60,00",
                          "vs": [{"tp": "v", "nmu": "ALFREDO GASPAR", "sgp": "PL"}]}]}]},
            {"n": "2", "nm": "FEDERAÇÃO", "tp": "f", "par": [{
                "n": "13", "sg": "PT",
                "cand": [{"n": "13", "nm": "LUIZ INÁCIO LULA DA SILVA", "nmu": "LULA",
                          "vap": "2880", "pvap": "40,00", "vs": []}]}]},
        ],
    }],
    "e": {"te": "10207", "c": "7700", "a": "2507"},
    "v": {"tv": "7700", "vv": "7201", "vb": "199", "tvn": "300"},
}


def test_to_int_handles_tse_missing_markers():
    assert tse.to_int("10207") == 10207
    assert tse.to_int("") == 0
    assert tse.to_int("#NULO") == 0
    assert tse.to_int("-1") == 0
    assert tse.to_int(None) == 0


def test_profile_sums_zones_into_municipality(profile_zip):
    agg = aggregate(profile_zip)

    assert agg.rows == 4
    assert agg.municipalities[1120] == ("AC", "ACRELÂNDIA")
    assert agg.totals[1120] == [180, 160, 2, 1]
    assert agg.totals[1570] == [7, 0, 0, 0]  # -1 biometrics is "missing", not negative
    table = agg.crosstabs["perfil_sexo_idade_civil"]
    assert table[(1120, "4", "2529", "1")] == 150  # zones 8 and 9 merged
    assert table[(1120, "2", "6064", "3")] == 30


def test_profile_keeps_labels_and_latin1_text(profile_zip):
    agg = aggregate(profile_zip)

    assert agg.labels["genero"] == {"4": "FEMININO", "2": "MASCULINO"}
    assert agg.labels["escolaridade"]["6"] == "ENSINO MÉDIO COMPLETO"
    assert agg.generated_at == "20/07/2026 09:21:00"


def test_profile_crosstabs_conserve_the_electorate(profile_zip):
    agg = aggregate(profile_zip)
    electorate = sum(total[0] for total in agg.totals.values())

    for name, table in agg.crosstabs.items():
        assert sum(table.values()) == electorate, name


def test_profile_tolerates_a_missing_column(profile_zip):
    rows = [dict(row) for row in tse.iter_profile_rows(profile_zip)]
    for row in rows:
        del row["CD_QUILOMBOLA"], row["DS_QUILOMBOLA"]

    columns = tse.resolve_count_columns(tse.sample_count_columns(rows))
    agg = tse.aggregate_profile(rows, columns)

    assert not agg.crosstabs["perfil_quilombola"]
    assert sum(agg.crosstabs["perfil_sexo_raca"].values()) == 187


def test_national_file_wins_over_per_state_files():
    names = ["perfil_2026_AC.csv", "perfil_2026_BRASIL.csv", "leiame.pdf"]
    assert tse.profile_members(names) == ["perfil_2026_BRASIL.csv"]
    assert tse.profile_members(["perfil_eleitorado_2026.csv", "leiame.pdf"]) == [
        "perfil_eleitorado_2026.csv"
    ]


def test_municipality_config_and_result_url():
    config = {"abr": [{"cd": "ac", "ds": "ACRE", "mu": [
        {"cd": "01120", "cdi": "1200013", "nm": "ACRELÂNDIA", "c": "n", "z": ["0008"]},
        {"cd": "01392", "cdi": "1200401", "nm": "RIO BRANCO", "c": "s", "z": ["0001"]},
    ]}]}

    acrelandia, rio_branco = tse.parse_municipality_config(config)

    assert (acrelandia.uf, acrelandia.cd_ibge, acrelandia.capital) == ("AC", "1200013", False)
    assert rio_branco.capital is True
    assert acrelandia.result_url == (
        "https://resultados.tse.jus.br/oficial/ele2026/6257/dados/ac/"
        "ac01120-c0001-e006257-u.json"
    )


def test_parse_result_reads_totals_and_candidates():
    summary, candidates = tse.parse_result(RESULT)

    assert summary["eleitorado"] == 10207
    assert summary["comparecimento"] + summary["abstencao"] == 10207
    assert (summary["votos_validos"], summary["votos_brancos"], summary["votos_nulos"]) == (7201, 199, 300)
    assert summary["totalizacao_final"] == "s"
    assert candidates == [
        {"numero": "22", "nome_urna": "FLAVIO BOLSONARO", "partido": "PL", "votos": 4321},
        {"numero": "13", "nome_urna": "LULA", "partido": "PT", "votos": 2880},
    ]


def test_parse_result_ignores_running_mates():
    _, candidates = tse.parse_result(RESULT)
    assert "ALFREDO GASPAR" not in {c["nome_urna"] for c in candidates}


def test_end_to_end_bundle(profile_zip, tmp_path, monkeypatch):
    config = {"abr": [{"cd": "ac", "mu": [
        {"cd": "01120", "cdi": "1200013", "nm": "ACRELÂNDIA", "c": "n"}]}]}

    def fake_get(url, **_):
        return json.dumps(config if "config" in url else RESULT).encode("utf-8")

    monkeypatch.setattr(tse, "http_get", fake_get)
    monkeypatch.chdir(tmp_path)

    assert tse.main(["--perfil-zip", str(profile_zip)]) == 0

    with zipfile.ZipFile(tmp_path / "tse2026_dados_v3.zip") as bundle:
        names = set(bundle.namelist())
        meta = json.loads(bundle.read("meta.json"))
        results = list(csv.DictReader(io.TextIOWrapper(bundle.open("resultado_municipios.csv"), "utf-8")))
    assert {"perfil_totais.csv", "perfil_sexo_idade_civil.csv", "resultado_candidatos.csv",
            "rotulos.json", "meta.json", "diagnostico.json"} <= names
    assert meta["perfil"]["eleitores"] == 187
    assert meta["resultado"]["candidatos"] == {"FLAVIO BOLSONARO": 4321, "LULA": 2880}
    assert results[0]["cd_tse"] == "1120" and results[0]["cd_ibge"] == "1200013"


def renamed(**names):
    return [names.get(column, column) for column in HEADER]


def test_count_columns_follow_the_official_layout(profile_zip):
    rows = list(tse.iter_profile_rows(profile_zip))

    assert tse.resolve_count_columns(tse.sample_count_columns(rows)) == {
        "eleitores": "QT_ELEITORES_PERFIL",
        "biometria": "QT_ELEITORES_BIOMETRIA",
        "deficiencia": "QT_ELEITORES_DEFICIENCIA",
        "nome_social": "QT_ELEITORES_INC_NM_SOCIAL",
    }


def test_sample_ignores_identifier_and_text_columns(profile_zip):
    sums = tse.sample_count_columns(tse.iter_profile_rows(profile_zip))

    assert set(sums) == {"QT_ELEITORES_PERFIL", "QT_ELEITORES_BIOMETRIA",
                         "QT_ELEITORES_DEFICIENCIA", "QT_ELEITORES_INC_NM_SOCIAL"}
    assert sums["QT_ELEITORES_PERFIL"] == 187


@pytest.mark.parametrize("profile_zip", [
    renamed(QT_ELEITORES_PERFIL="QT_ELEITOR", QT_ELEITORES_INC_NM_SOCIAL="QT_ELEITOR_NOME_SOCIAL"),
    renamed(QT_ELEITORES_PERFIL="QTD_ELEITORES", QT_ELEITORES_INC_NM_SOCIAL="QTD_NOME_SOCIAL"),
    renamed(QT_ELEITORES_PERFIL="ELEITORES_APTOS", QT_ELEITORES_INC_NM_SOCIAL="ELEITORES_NM_SOCIAL"),
], indirect=True, ids=["QT_ELEITOR", "QTD_ELEITORES", "ELEITORES_APTOS"])
def test_voters_are_counted_whatever_the_column_is_called(profile_zip):
    agg = aggregate(profile_zip)

    assert agg.totals[1120] == [180, 160, 2, 1]
    assert sum(agg.crosstabs["perfil_sexo_idade_civil"].values()) == 187


def test_header_is_normalised():
    assert tse.normalize_header(['\ufeffdt_geracao', ' Qt_Eleitores_Perfil ']) == [
        "DT_GERACAO", "QT_ELEITORES_PERFIL"]


def test_bundle_is_written_with_a_diagnostic_even_without_voters(profile_zip, tmp_path, monkeypatch):
    monkeypatch.setattr(tse, "resolve_count_columns", lambda sums: dict.fromkeys(tse.COUNT_NAMES))
    monkeypatch.chdir(tmp_path)

    assert tse.main(["--perfil-zip", str(profile_zip), "--skip-results"]) == 0

    with zipfile.ZipFile(tmp_path / "tse2026_dados_v3.zip") as bundle:
        diagnostic = json.loads(bundle.read("diagnostico.json"))
    assert diagnostic["cabecalho"] == HEADER
    assert diagnostic["linhas_brutas"][0].startswith('"DT_GERACAO";"HH_GERACAO"')
    assert diagnostic["somas_na_amostra"]["QT_ELEITORES_PERFIL"] == 187
    assert len(diagnostic["primeiras_linhas"]) == 4


# Header and first rows exactly as they appear in perfil_eleitorado_2026_BRASIL.csv
REAL_2026 = (
    '"DT_GERACAO";"HH_GERACAO";"AA_ELEICAO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";'
    '"CD_GENERO";"DS_GENERO";"CD_ESTADO_CIVIL";"DS_ESTADO_CIVIL";"CD_FAIXA_ETARIA";"DS_FAIXA_ETARIA";'
    '"CD_GRAU_ESCOLARIDADE";"DS_GRAU_ESCOLARIDADE";"CD_RACA_COR";"DS_RACA_COR";"CD_IDENTIDADE_GENERO";'
    '"DS_IDENTIDADE_GENERO";"CD_QUILOMBOLA";"DS_QUILOMBOLA";"CD_INTERPRETE_LIBRAS";"DS_INTERPRETE_LIBRAS";'
    '"QT_ELEITORES";"QT_ELEITORES_BIOMETRIA";"QT_ELEITORES_DEFICIENCIA";"QT_ELEITORES_NOME_SOCIAL"\r\n'
    '"14/07/2026";"18:03:33";2026;"MA";"09490";"VIANA";20;2;"MASCULINO";1;"SOLTEIRO";5559;"55 a 59 anos";'
    '2;"LÊ E ESCREVE";"2";"Preta";1;"Cisgênero";2;"NÃO";2;"NÃO";4;4;0;0\r\n'
    '"14/07/2026";"18:03:33";2026;"SP";"71137";"SÃO ROQUE";131;4;"FEMININO";3;"CASADO";8084;"80 a 84 anos";'
    '1;"ANALFABETO";"-1";"NÃO INFORMADO";-1;"NÃO INFORMADO";-1;"NÃO INFORMADO";-1;"NÃO INFORMADO";12;10;2;0\r\n'
)


@pytest.fixture
def real_zip(tmp_path):
    path = tmp_path / "perfil_eleitorado_2026.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("perfil_eleitorado_2026_SP.csv", REAL_2026.encode("latin-1"))
        archive.writestr("perfil_eleitorado_2026_BRASIL.csv", REAL_2026.encode("latin-1"))
        archive.writestr("leiame.pdf", b"%PDF")
    return path


def test_real_2026_layout_resolves_the_voter_column(real_zip):
    rows = list(tse.iter_profile_rows(real_zip))

    columns = tse.resolve_count_columns(tse.sample_count_columns(rows))

    assert len(rows) == 2  # only the BRASIL member, not BRASIL plus the state file
    assert columns == {
        "eleitores": "QT_ELEITORES",
        "biometria": "QT_ELEITORES_BIOMETRIA",
        "deficiencia": "QT_ELEITORES_DEFICIENCIA",
        "nome_social": "QT_ELEITORES_NOME_SOCIAL",
    }


def test_real_2026_layout_counts_voters_not_the_year(real_zip):
    agg = aggregate(real_zip)

    assert agg.totals[9490] == [4, 4, 0, 0]
    assert agg.totals[71137] == [12, 10, 2, 0]
    assert agg.crosstabs["perfil_sexo_idade_civil"][(71137, "4", "8084", "3")] == 12
    assert agg.municipalities[71137] == ("SP", "SÃO ROQUE")


def test_year_column_is_never_a_count():
    sums = {"AA_ELEICAO": 607800000, "QT_ELEITORES": 4372672, "QT_ELEITORES_BIOMETRIA": 3894929}
    assert tse.resolve_count_columns(sums)["eleitores"] == "QT_ELEITORES"
    sums = {"ANO_REF": 607800000, "QT_APTOS": 4372672, "QT_ELEITORES_BIOMETRIA": 3894929}
    assert tse.resolve_count_columns(sums)["eleitores"] == "QT_APTOS"


def test_profile_is_checked_against_the_official_electorate(real_zip, tmp_path, monkeypatch, capsys):
    config = {"abr": [{"cd": "ac", "mu": [{"cd": "01120", "cdi": "1200013", "nm": "X", "c": "n"}]}]}
    result = {**RESULT, "e": {"te": "16", "c": "12", "a": "4"}}
    monkeypatch.setattr(tse, "http_get", lambda url, **_: json.dumps(
        config if "config" in url else result).encode("utf-8"))
    monkeypatch.chdir(tmp_path)

    tse.main(["--perfil-zip", str(real_zip)])

    meta = json.loads((tmp_path / "tse2026_out" / "meta.json").read_text(encoding="utf-8"))
    assert meta["conferencia"] == {"eleitores_perfil": 16, "eleitorado_oficial": 16, "razao": 1.0}
    assert "OK" in capsys.readouterr().out
