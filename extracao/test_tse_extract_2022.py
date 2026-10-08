"""Tests for tse_extract_2022.py - run with: python -m pytest test_tse_extract_2022.py"""
import csv
import io
import json
import zipfile

import pytest

import tse_extract_2022 as tse

VOTE_HEADER = ["DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "NR_TURNO", "SG_UF", "SG_UE", "CD_MUNICIPIO", "NM_MUNICIPIO",
               "NR_ZONA", "CD_CARGO", "DS_CARGO", "NR_CANDIDATO", "NM_URNA_CANDIDATO", "SG_PARTIDO",
               "ST_VOTO_EM_TRANSITO", "QT_VOTOS_NOMINAIS", "QT_VOTOS_NOMINAIS_VALIDOS"]
DETAIL_HEADER = ["DT_GERACAO", "NR_TURNO", "SG_UF", "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "CD_CARGO", "DS_CARGO",
                 "QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES", "QT_VOTOS_BRANCOS", "QT_TOTAL_VOTOS_NULOS",
                 "QT_VOTOS_NULOS", "QT_VOTOS_NULOS_TECNICOS"]


def vote(turno, uf, mun, name, zona, cargo, numero, urna, partido, votos):
    cd = {"Presidente": "1", "Governador": "3"}[cargo]
    return ["04/11/2022", "10:00:00", "2022", turno, uf, "BR", mun, name, zona, cd, cargo, numero, urna, partido, "N", votos, votos]


PRESIDENT = [
    vote(1, "AC", "01120", "ACRELÂNDIA", 8, "Presidente", 13, "LULA", "PT", 3000),
    vote(1, "AC", "01120", "ACRELÂNDIA", 9, "Presidente", 13, "LULA", "PT", 500),
    vote(1, "AC", "01120", "ACRELÂNDIA", 8, "Presidente", 22, "JAIR BOLSONARO", "PL", 4000),
    vote(1, "AC", "01120", "ACRELÂNDIA", 8, "Presidente", 15, "SIMONE TEBET", "MDB", 200),
    vote(2, "AC", "01120", "ACRELÂNDIA", 8, "Presidente", 13, "LULA", "PT", 3700),
    vote(2, "AC", "01120", "ACRELÂNDIA", 8, "Presidente", 22, "JAIR BOLSONARO", "PL", 4100),
    vote(1, "ZZ", "29971", "LISBOA", 1, "Presidente", 13, "LULA", "PT", 90),
]
GOVERNOR = [vote(1, "AC", "01120", "ACRELÂNDIA", 8, "Governador", 11, "GLADSON", "PP", 5000)]


def as_csv(header, rows, quote_all=True):
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_NONNUMERIC)
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue().encode("latin-1")


@pytest.fixture
def votes_zip(tmp_path):
    path = tmp_path / "votacao_candidato_munzona_2022.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("votacao_candidato_munzona_2022_AC.csv", as_csv(VOTE_HEADER, GOVERNOR))
        archive.writestr("votacao_candidato_munzona_2022_BR.csv", as_csv(VOTE_HEADER, PRESIDENT, quote_all=False))
        archive.writestr("votacao_candidato_munzona_2022_BRASIL.csv", as_csv(VOTE_HEADER, GOVERNOR + PRESIDENT))
        archive.writestr("leiame.pdf", b"%PDF")
    return path


@pytest.fixture
def detail_zip(tmp_path):
    rows = [
        ["04/11/2022", 1, "AC", "01120", "ACRELÂNDIA", 8, 1, "Presidente", 9000, 7000, 2000, 100, 200, 180, 20],
        ["04/11/2022", 1, "AC", "01120", "ACRELÂNDIA", 9, 1, "Presidente", 1000, 700, 300, 10, 20, 20, 0],
        ["04/11/2022", 1, "AC", "01120", "ACRELÂNDIA", 8, 3, "Governador", 9000, 7000, 2000, 400, 500, 500, 0],
        ["04/11/2022", 2, "AC", "01120", "ACRELÂNDIA", 8, 1, "Presidente", 10000, 8000, 2000, 80, 120, 120, 0],
        ["04/11/2022", 1, "ZZ", "29971", "LISBOA", 1, 1, "Presidente", 300, 100, 200, 4, 6, 6, 0],
    ]
    path = tmp_path / "detalhe_votacao_munzona_2022.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("detalhe_votacao_munzona_2022_BRASIL.csv", as_csv(DETAIL_HEADER, rows))
    return path


@pytest.fixture
def profile_zip(tmp_path):
    header = ["DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "SG_UF", "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "CD_GENERO",
              "DS_GENERO", "CD_ESTADO_CIVIL", "DS_ESTADO_CIVIL", "CD_FAIXA_ETARIA", "DS_FAIXA_ETARIA",
              "CD_GRAU_ESCOLARIDADE", "DS_GRAU_ESCOLARIDADE", "QT_ELEITORES_PERFIL", "QT_ELEITORES_BIOMETRIA",
              "QT_ELEITORES_DEFICIENCIA", "QT_ELEITORES_INC_NM_SOCIAL"]
    rows = [
        ["04/11/2022", "10:00:00", 2022, "AC", "01120", "ACRELÂNDIA", 8, 4, "FEMININO", 1, "SOLTEIRO", 2529, "25 a 29 anos", 6, "ENSINO MÉDIO COMPLETO", 6000, 5000, 20, 1],
        ["04/11/2022", "10:00:00", 2022, "AC", "01120", "ACRELÂNDIA", 9, 2, "MASCULINO", 3, "CASADO", 6064, "60 a 64 anos", 3, "ENSINO FUNDAMENTAL INCOMPLETO", 4000, 3000, 30, 0],
    ]
    path = tmp_path / "perfil_eleitorado_2022.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("perfil_eleitorado_2022.csv", as_csv(header, rows, quote_all=False))
    return path


def test_member_plans_never_mix_files_that_repeat_the_same_votes():
    names = ["v_2022_AC.csv", "v_2022_SP.csv", "v_2022_BR.csv", "v_2022_BRASIL.csv", "leiame.pdf"]
    assert tse.member_plans(names) == [["v_2022_BR.csv"], ["v_2022_BRASIL.csv"], ["v_2022_AC.csv", "v_2022_SP.csv", "v_2022_BR.csv"]]
    assert tse.member_plans(["only.csv"]) == [["only.csv"]]


def test_votes_are_presidential_only_and_counted_once(votes_zip):
    diagnostic = {}
    data = tse.load_with_plans(votes_zip, tse.vote_columns, tse.read_votes,
                               ("turno", "municipio", "cargo", "numero", "votos"), diagnostic)

    assert data["votes"][1][1120] == {"13": 3500, "22": 4000, "15": 200}   # zones 8 and 9 merged, governor ignored
    assert data["votes"][2][1120] == {"13": 3700, "22": 4100}
    assert data["places"][29971] == ("ZZ", "LISBOA")
    assert data["candidates"]["22"] == ("JAIR BOLSONARO", "PL")
    assert diagnostic["tentativas"][0]["membros"] == ["votacao_candidato_munzona_2022_BR.csv"]


def test_falls_back_to_the_next_plan_when_the_first_has_no_president(tmp_path):
    path = tmp_path / "v.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("v_2022_BR.csv", as_csv(VOTE_HEADER, GOVERNOR))
        archive.writestr("v_2022_BRASIL.csv", as_csv(VOTE_HEADER, GOVERNOR + PRESIDENT))
    diagnostic = {}

    data = tse.load_with_plans(path, tse.vote_columns, tse.read_votes, ("turno", "municipio", "cargo", "numero", "votos"), diagnostic)

    assert data["votes"][1][1120]["13"] == 3500
    assert [a["linhas_presidente"] for a in diagnostic["tentativas"]] == [0, 7]


def test_vote_columns_prefer_valid_votes_and_survive_renames():
    assert tse.vote_columns(VOTE_HEADER)["votos"] == "QT_VOTOS_NOMINAIS_VALIDOS"
    old = [c for c in VOTE_HEADER if c != "QT_VOTOS_NOMINAIS_VALIDOS"]
    assert tse.vote_columns(old)["votos"] == "QT_VOTOS_NOMINAIS"
    renamed = ["AA_ELEICAO", "NR_TURNO", "SG_UF", "CD_MUNICIPIO", "CD_CARGO", "NR_VOTAVEL", "NM_VOTAVEL", "QT_VOTOS"]
    columns = tse.vote_columns(renamed)
    assert (columns["cargo"], columns["numero"], columns["nome"], columns["votos"]) == ("CD_CARGO", "NR_VOTAVEL", "NM_VOTAVEL", "QT_VOTOS")


def test_detail_columns_take_total_nulls_not_a_component():
    columns = tse.detail_columns(DETAIL_HEADER)
    assert columns["nulos"] == "QT_TOTAL_VOTOS_NULOS"
    assert columns["eleitorado"] == "QT_APTOS" and columns["abstencao"] == "QT_ABSTENCOES"
    assert tse.detail_columns(["NR_TURNO", "CD_MUNICIPIO", "DS_CARGO", "QT_APTOS", "QT_COMPARECIMENTO", "QT_VOTOS_NULOS"])["nulos"] == "QT_VOTOS_NULOS"


def test_details_sum_zones_for_president_only(detail_zip):
    data = tse.load_with_plans(detail_zip, tse.detail_columns, tse.read_details,
                               ("turno", "municipio", "cargo", "eleitorado", "comparecimento"), {})

    assert data["detail"][1][1120] == [10000, 7700, 2300, 110, 220]
    assert data["detail"][2][1120] == [10000, 8000, 2000, 80, 120]


def test_end_to_end_bundle(votes_zip, detail_zip, profile_zip, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(tse, "OFFICIAL", {1: {"13": 3590, "22": 4000}, 2: {"13": 3700, "22": 4100}})
    monkeypatch.chdir(tmp_path)

    assert tse.main(["--perfil-zip", str(profile_zip), "--votos-zip", str(votes_zip), "--detalhe-zip", str(detail_zip)]) == 0

    with zipfile.ZipFile(tmp_path / "tse2022_dados.zip") as bundle:
        names = set(bundle.namelist())
        meta = json.loads(bundle.read("meta.json"))
        first = list(csv.DictReader(io.TextIOWrapper(bundle.open("resultado_municipios.csv"), "utf-8")))
        second = list(csv.DictReader(io.TextIOWrapper(bundle.open("resultado_municipios_t2.csv"), "utf-8")))
        cands = list(csv.DictReader(io.TextIOWrapper(bundle.open("resultado_candidatos.csv"), "utf-8")))
        totals = list(csv.DictReader(io.TextIOWrapper(bundle.open("perfil_totais.csv"), "utf-8")))
    assert {"perfil_sexo_idade_civil.csv", "perfil_sexo_idade_escolaridade.csv", "rotulos.json", "diagnostico.json",
            "resultado_candidatos_t2.csv"} <= names
    assert "perfil_sexo_raca.csv" not in names          # 2022 has no colour/race column
    acre = next(r for r in first if r["cd_tse"] == "1120")
    assert (acre["uf"], acre["eleitorado"], acre["comparecimento"], acre["votos_validos"], acre["votos_brancos"], acre["votos_nulos"]) == \
        ("AC", "10000", "7700", "7700", "110", "220")
    assert second[0]["votos_validos"] == "7800"
    assert {(c["numero"], c["nome_urna"], c["votos"]) for c in cands if c["cd_tse"] == "1120"} == \
        {("13", "LULA", "3500"), ("22", "JAIR BOLSONARO", "4000"), ("15", "SIMONE TEBET", "200")}
    assert totals[0]["eleitores"] == "10000"
    assert meta["perfil"]["eleitores"] == 10000
    assert meta["resultado"]["1"]["conferencia"]["13"] == {"extraido": 3590, "oficial": 3590, "razao": 1.0}
    assert capsys.readouterr().out.count(") OK") == 4


def test_a_broken_file_does_not_lose_the_others(votes_zip, profile_zip, tmp_path, monkeypatch):
    broken = tmp_path / "detalhe.zip"
    broken.write_bytes(b"not a zip")
    monkeypatch.chdir(tmp_path)

    assert tse.main(["--perfil-zip", str(profile_zip), "--votos-zip", str(votes_zip), "--detalhe-zip", str(broken)]) == 0

    with zipfile.ZipFile(tmp_path / "tse2022_dados.zip") as bundle:
        diagnostic = json.loads(bundle.read("diagnostico.json"))
        cands = bundle.read("resultado_candidatos.csv").decode("utf-8")
    assert "BadZipFile" in diagnostic["erros"][0]
    assert "LULA" in cands
