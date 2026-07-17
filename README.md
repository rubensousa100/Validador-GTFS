# Validador GTFS — Memorando CIM Tâmega e Sousa (V12.2025)

Ferramenta web para verificar a conformidade de feeds GTFS das concessionárias
com as regras do Memorando de Gestão de Alterações GTFS. Todo o processamento
decorre **localmente no browser** — nenhum ficheiro sai do computador.

## Estrutura do projeto

```
validador/
├── index.html          Estrutura da página (apenas markup)
├── css/
│   └── styles.css      Estilos (design tokens, layout, impressão)
└── js/
    ├── config.js       Regras do memorando (editável sem tocar na lógica)
    └── app.js          Lógica: parser CSV, validação, relatório, exportação
```

## Utilização

Abrir `index.html` num browser moderno (Chrome, Edge, Firefox) e arrastar o
feed GTFS (`.zip`). É necessária ligação à internet apenas para carregar a
biblioteca JSZip a partir do CDN.

## Ajustar as regras

As regras verificadas (ficheiros mínimos, formato de `stop_id`, envolvente
geográfica, limites de listagem, etc.) estão isoladas em `js/config.js`,
podendo ser ajustadas sem alterar a lógica da aplicação.

## Dependências

- [JSZip 3.10.1](https://stuk.github.io/jszip/) — leitura de ficheiros `.zip`
  no browser (carregada via CDN cdnjs).

## Âmbito

O relatório cobre as regras **automatizáveis** do memorando. Regras
qualitativas (convenções de `stop_name`, catálogo de calendários do Anexo I,
composição do `trip_id`, conteúdo do `patterns_shapeid.txt`) exigem revisão
humana. Complementar com o validador oficial da norma:
<https://gtfs-validator.mobilitydata.org/>.
