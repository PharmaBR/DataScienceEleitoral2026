# Explorador do Eleitorado Brasileiro

**Um laboratório aberto, não um veredito.** Este painel põe lado a lado o resultado oficial e o perfil do eleitorado dos 5.571 municípios brasileiros, no primeiro turno das eleições presidenciais de 2026 e de 2022, e deixa as conclusões por conta de quem explora.

Página: https://pharmabr.github.io/DataScienceEleitoral2026/

Autores: [PharmaBR](https://github.com/PharmaBR) e [Karina-RM](https://github.com/Karina-RM).

> **Somente primeiro turno.** Todas as figuras e comparações usam o 1º turno: 4 de outubro de 2026 e 2 de outubro de 2022. A mudança entre eleições compara sempre 1º turno com 1º turno. O segundo turno (25 de outubro de 2026 e 30 de outubro de 2022) não entra em nenhum número.

Ele foi feito para provocar quem trabalha com dados a explorar com método: formular uma hipótese, procurar o padrão, tentar derrubá-lo e só então confiar um pouco nele.

## O que há na página

A página tem dois modos:

- **Leitura rápida**: um resumo em linguagem simples, com frases do tipo "de cada 100 votos".
- **Explorar os dados**: mapa, pirâmide etária, dispersão, ranking de correlações, regressão, grade de grupos e tabela de municípios, com notas de leitura e de metodologia em cada seção.

O modo de exploração abre com um **roteiro**:

1. **Pergunte**: comece por uma hipótese que possa estar errada.
2. **Observe**: procure o padrão no mapa e na dispersão antes de olhar qualquer coeficiente.
3. **Compare**: mude a região, a UF, o porte e a eleição. O padrão resiste?
4. **Controle**: compare cada município com os da própria UF e mantenha as outras características constantes.
5. **Duvide**: leia os cuidados abaixo e procure o município que contraria a regra.

Seis cartões de investigação preparam o painel para perguntas concretas (geografia ou perfil, diferenças entre regiões, estado civil, sexo, mudança entre os primeiros turnos de 2022 e 2026 e comparecimento). Os números de cada cartão são calculados na hora, a partir dos dados.

## Antes de concluir

1. **Lugares não são pessoas.** Tudo compara municípios. Nenhuma figura diz como votou um grupo de eleitores (falácia ecológica).
2. **Correlação não é causa.** Uma característica pode acompanhar o voto apenas porque anda junto com outra, medida ou não pelo painel.
3. **Faltam variáveis importantes.** O cadastro eleitoral não traz renda, religião nem ocupação, e a cor ou raça está registrada para poucos eleitores.
4. **Quem procura, acha.** Com tantas características, indicadores e recortes, algumas relações aparentes surgem por coincidência, sobretudo em recortes pequenos. Trate cada achado como hipótese.
5. **Vizinhos se parecem.** Municípios próximos não são observações independentes. Por isso o painel não mostra valores-p nem intervalos de confiança.
6. **O cadastro envelhece.** Estado civil e escolaridade são os declarados no alistamento. O perfil descreve todos os eleitores aptos, e não apenas quem compareceu.
7. **Duas eleições, candidatos diferentes.** Lula concorreu nas duas; o outro candidato mais votado foi Jair Bolsonaro em 2022 e Flávio Bolsonaro em 2026. Tudo é primeiro turno comparado com primeiro turno.
8. **Modelos simplificam, e os pesos concentram.** As retas e a regressão supõem relações lineares. Como cada município pesa conforme o seu eleitorado, poucas cidades grandes dominam as contas.

## Independência

Projeto independente, sem vínculo com o TSE, com partidos, candidatos ou campanhas. Usa apenas resultados oficiais e dados públicos. Não é pesquisa eleitoral nem enquete: não coleta opiniões e não estima intenção de voto. Azul e vermelho são uma convenção visual para distinguir os dois candidatos mais votados, e não uma posição.

A página não usa cookies nem ferramentas de medição de audiência. Guarda apenas, no navegador, duas preferências de exibição. Os dados são contagens por município, como publicadas pelo TSE, sem nomes nem registros individuais. As únicas requisições externas são as das tipografias, feitas aos servidores do Google Fonts, que recebem o endereço IP e a identificação do navegador de quem abre a página, assim como o serviço que a hospeda.

## Fontes e licenças

| Item | Origem | Licença |
| --- | --- | --- |
| Resultados de 2026 | TSE, [divulgação de resultados](https://resultados.tse.jus.br/), um arquivo por município | Dados públicos oficiais, citados com atribuição ao TSE |
| Resultados de 2022 e perfil do eleitorado | TSE, [Portal de Dados Abertos](https://dadosabertos.tse.jus.br/) | Creative Commons Atribuição (CC BY), como indicado no portal |
| Coordenadas dos municípios | [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) | MIT, © 2016 Kelvin S. do Prado |
| Contornos das UFs | Malha municipal do IBGE, via [tbrugz/geodata-br](https://github.com/tbrugz/geodata-br), agregada por UF e simplificada | CC0 1.0 no repositório; fonte dos dados: IBGE |
| Gráficos | [D3](https://d3js.org/) 7.9.0, incluída na página | ISC, © 2010–2023 Mike Bostock |
| Tipografia | Archivo (Omnibus-Type), Public Sans (USWDS) e IBM Plex Mono (IBM), servidas pelo Google Fonts | SIL Open Font License 1.1 |

O resumo está em [NOTICE.md](NOTICE.md) e os textos das licenças, em [src/vendor/NOTICES.txt](src/vendor/NOTICES.txt). Esses textos também viajam dentro do `index.html`.

**Este projeto**, de PharmaBR e Karina-RM: o código está sob a licença [MIT](LICENSE). Os textos e as figuras do painel estão sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.pt-br): podem ser reutilizados com indicação da fonte. Os dados seguem as licenças das suas fontes.

### Como citar

> PharmaBR; Karina-RM. Explorador do Eleitorado Brasileiro: primeiro turno das eleições presidenciais de 2022 e 2026. 2026. Dados: Tribunal Superior Eleitoral (TSE). Disponível em: https://pharmabr.github.io/DataScienceEleitoral2026/.

## Como publicar

`index.html` é a página completa em um único arquivo, com os dados, a biblioteca de gráficos e os avisos de licença incluídos. Basta servi-lo em qualquer hospedagem estática (GitHub Pages, Cloudflare Pages ou um servidor próprio).

## Como reconstruir

1. **Extração** (Python 3.9+, só biblioteca padrão), na sua máquina:

   ```
   python extracao/tse_extract_v3.py      # gera tse2026_dados_v3.zip
   python extracao/tse_extract_2022.py    # gera tse2022_dados.zip
   ```

   Os dois scripts conferem os totais com os números oficiais do TSE e gravam um diagnóstico dentro do zip.

   O script de 2026 lê a eleição 6257 (1º turno). O de 2022 grava os dois turnos em arquivos separados (`resultado_*.csv` para o 1º turno e `resultado_*_t2.csv` para o 2º); a montagem da página lê apenas os arquivos do 1º turno.

2. **Referências geográficas**: o `municipios.csv` de kelvins/municipios-brasileiros em uma pasta de referência e os 27 arquivos `geojs-<código da UF>-mun.json` de tbrugz/geodata-br em outra.

3. **Montagem** (precisa de `shapely`), com os dois zips descompactados:

   ```
   python src/make_states.py PASTA_MALHA estados.geojson
   python src/build_data.py PASTA_2026 PASTA_REF estados.geojson dados.json PASTA_2022
   python src/assemble.py dados.json pagina.html --author "SEU NOME" --repo URL_DO_REPOSITORIO --site URL_DA_PAGINA
   python src/assemble_site.py pagina.html .
   ```

   `--author`, `--repo` e `--site` são opcionais e só alimentam os créditos e a citação.

4. **Testes**:

   ```
   cd extracao && python -m pytest     # extração
   cd src && python -m pytest          # montagem da página
   ```

## Atualização dos dados

Os números refletem os arquivos do TSE nas datas indicadas na própria página. Retotalizações e decisões judiciais posteriores podem alterar os totais oficiais. Em caso de divergência, vale o que o TSE publica.
