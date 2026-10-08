# Avisos de terceiros

Este repositório e a página `index.html` usam dados e programas de outras pessoas e instituições. A tabela resume a origem, a licença e o uso de cada item.

| Item | Origem | Licença | Como é usado |
| --- | --- | --- | --- |
| Resultados de 2022 e perfil do eleitorado | Tribunal Superior Eleitoral (TSE), [Portal de Dados Abertos](https://dadosabertos.tse.jus.br/) | Creative Commons Atribuição (CC BY), como indicado no portal | Agregados por município e incluídos em `index.html` |
| Resultados de 2026 | Tribunal Superior Eleitoral (TSE), [divulgação de resultados](https://resultados.tse.jus.br/) | Dados públicos oficiais, citados com atribuição ao TSE | Incluídos em `index.html` |
| Coordenadas das sedes municipais | [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) | MIT, © 2016 Kelvin S. do Prado | Latitude e longitude incluídas em `index.html` |
| Contornos das UFs | Malha municipal do IBGE, via [tbrugz/geodata-br](https://github.com/tbrugz/geodata-br) | CC0 1.0 no repositório; fonte dos dados: IBGE | Municípios agregados por UF e simplificados (`src/make_states.py`), incluídos em `index.html` |
| D3 7.9.0 | [d3js.org](https://d3js.org/) | ISC, © 2010–2023 Mike Bostock; o pacote reúne módulos com avisos próprios | Cópia em `src/vendor/d3.min.js`, incluída em `index.html` |
| Archivo, Public Sans, IBM Plex Mono | Omnibus-Type, USWDS e IBM, servidas pelo Google Fonts | SIL Open Font License 1.1 | Carregadas do Google Fonts pelo navegador; não são redistribuídas aqui |

## Textos das licenças

Os avisos de direitos autorais e os textos de permissão exigidos por essas licenças estão em [`src/vendor/NOTICES.txt`](src/vendor/NOTICES.txt). O mesmo arquivo viaja dentro de `index.html` e pode ser lido na própria página, em "Créditos e licenças", no item "Textos das licenças de terceiros". Assim, quem copia apenas o `index.html` leva os avisos junto.

## Sobre os dados do TSE

Os dados foram agregados e recombinados. As análises e interpretações são de responsabilidade de quem as faz, e não do TSE. Este projeto não tem vínculo com o TSE, com o IBGE nem com os autores dos projetos acima.
