# Evidence Selection — Seleção de Evidências

## Visão Geral

O serviço de seleção de evidências é responsável por filtrar, ranquear e diversificar as evidências recuperadas antes do grounding. Garante que apenas evidências relevantes e não-redundantes sejam utilizadas.

## Pipeline de Seleção

```
Candidatas → Ranking → Deduplicação → Diversificação → Evidências Selecionadas
```

## Algoritmo de Ranking

Evidências são ordenadas por `score` decrescente. O score combina:
- Similaridade semântica com a query
- Confiança da fonte
- Relevância contextual

## Remoção de Duplicatas

Duas evidências são consideradas duplicatas quando possuem >90% de sobreposição de palavras significativas (palavras com mais de 2 caracteres). A com maior score é mantida.

## Detecção de Contradições

O sistema detecta pares de evidências contraditórias procurando por:
- Uma evidência contendo padrão de negação ("não", "nunca", "nenhum") com palavras-chave
- Outra evidência contendo as mesmas palavras-chave sem negação

Contradições são sinalizadas mas não removidas — são apresentadas ao revisor humano.

## Diversificação

Para evitar viés de fonte, o sistema limita a quantidade máxima de evidências por fonte (padrão: 3). Isso garante representação de múltiplas perspectivas.

## Ponderação por Confiança

`weightByConfidence` multiplica o score pela confiança, priorizando evidências de fontes mais confiáveis.
