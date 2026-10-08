# Explorador do Eleitorado Brasileiro

Página interativa que mostra como cada um dos 5.571 municípios brasileiros votou para presidente no primeiro turno de 2026 e de 2022, e quem são os seus eleitores: sexo, idade, estado civil e escolaridade.

A página tem dois modos:

- **Leitura rápida**: um resumo em linguagem simples, com frases do tipo "de cada 100 votos".
- **Explorar os dados**: mapa, pirâmide etária, dispersão, ranking de correlações, regressão e tabela de municípios, com notas de leitura e de metodologia em cada seção.

## Como publicar

`index.html` é a página completa em um único arquivo. Basta servi-lo em qualquer hospedagem estática (GitHub Pages, Cloudflare Pages ou um servidor próprio). Ele carrega apenas a biblioteca d3 (cdnjs) e as fontes (Google Fonts) de CDNs públicas.

## Fontes dos dados

- **Resultados de 2026**: serviço de divulgação de resultados do TSE, um arquivo por município.
- **Resultados de 2022**: dados abertos do TSE (votação nominal e detalhe da apuração por município e zona).
- **Perfil do eleitorado**: dados abertos do TSE, somado das zonas eleitorais para os municípios.
- **Coordenadas dos municípios**: [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros).
- **Contornos das UFs**: [codeforamerica/click_that_hood](https://github.com/codeforamerica/click_that_hood).

## Como reconstruir

1. Extração (Python 3.9+, só biblioteca padrão), na sua máquina:

   ```
   python extracao/tse_extract_v3.py      # gera tse2026_dados_v3.zip
   python extracao/tse_extract_2022.py    # gera tse2022_dados.zip
   ```

   Os dois scripts conferem os totais com os números oficiais do TSE e gravam um diagnóstico dentro do zip.

2. Montagem (precisa de `shapely`), com os dois zips descompactados, o `municipios.csv` em uma pasta de referência e o GeoJSON das UFs:

   ```
   python src/build_data.py PASTA_2026 PASTA_REF brazil-states.geojson dados.json PASTA_2022
   python src/assemble.py dados.json pagina.html
   python src/assemble_site.py pagina.html .
   ```

3. Testes da extração:

   ```
   cd extracao && python -m pytest
   ```

## Limites

- As relações comparam municípios, não pessoas. O voto é secreto, e nada aqui permite dizer como um grupo de pessoas votou.
- Estado civil e escolaridade são os declarados no alistamento e podem estar desatualizados.
- Cor ou raça não é analisada: poucos eleitores a têm registrada.
- A mudança entre 2022 e 2026 compara o candidato da família Bolsonaro em cada eleição (Jair em 2022, Flávio em 2026) com Lula.
