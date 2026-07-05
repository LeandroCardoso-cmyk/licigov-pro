# Observabilidade do Grafo

## Visao Geral

A observabilidade do Knowledge Graph garante que o sistema permaneca saudavel, performatico
e confiavel. Define metricas, alertas, dashboards e rotinas de manutencao.

## Metricas de Saude

### Metricas Estruturais

| Metrica | Descricao | Calculo |
|---------|-----------|---------|
| Total de nos | Quantidade de entidades | `COUNT(nodes)` |
| Total de arestas | Quantidade de relacoes | `COUNT(edges)` |
| Grau medio | Conexoes por no | `2 * arestas / nos` |
| Densidade | Conexoes existentes vs possiveis | `arestas / (nos*(nos-1)/2)` |
| Nos orfaos | Nos sem conexao | `COUNT(nodes WHERE degree=0)` |
| Componentes conectados | Subgrafos isolados | Algoritmo de componentes |

### Metricas de Qualidade

| Metrica | Faixa ideal |
|---------|-------------|
| Completude (nos com metadados) | > 90% |
| Consistencia (arestas com peso e tipo) | > 95% |
| Conectividade (nos com 2+ conexoes) | > 80% |
| Arestas sem peso | < 5% |
| Nos sem tipo | 0% |

## Monitoramento de Crescimento

- **Novos nos/arestas por dia:** Entidades e relacoes criadas nas ultimas 24h
- **Taxa semanal:** Variacao percentual semana a semana
- **Tendencias:** Fase inicial (50-100 nos/semana), estavel (10-30), madura (refinamento)

**Alertas de crescimento:**
- Zero crescimento por 7 dias: possivel problema de ingestao
- Crescimento explosivo (>200 nos/dia): possivel duplicacao
- Reducao sustentada: investigar exclusoes indevidas

## Deteccao de Anomalias

### Nos Orfaos
Causas: importacao parcial, falha na criacao de relacoes, entidades obsoletas.
Alerta quando `nos_orfaos / total_nos > 0.05`.

### Clusters Isolados
Causas: dominio nao integrado, falha em arestas entre dominios, importacao sem mapeamento.
Alerta quando `componentes_conectados > 3`.

### Arestas sem Peso
Causas: criacao automatica sem scoring, migracao de legados, bug na pipeline.
Alerta quando `arestas_sem_peso / total_arestas > 0.05`.

### Nos com Grau Excessivo
Alerta quando `grau(no) > 100`. Investigar se o no esta generico e deve ser subdividido.

## Score de Qualidade

```
score = completude*0.30 + consistencia*0.25 + conectividade*0.25
        + (1-taxa_orfaos)*0.10 + (1-taxa_sem_peso)*0.10
```

| Score | Classificacao | Acao |
|-------|--------------|------|
| 0.90-1.00 | Excelente | Monitoramento padrao |
| 0.75-0.89 | Bom | Atencao a metricas individuais |
| 0.60-0.74 | Regular | Manutencao preventiva |
| 0.40-0.59 | Critico | Manutencao corretiva urgente |
| 0.00-0.39 | Degradado | Intervencao imediata |

## Alertas Automaticos

```json
{
  "alertas": [
    {"metrica": "score_qualidade", "condicao": "< 0.75", "severidade": "warning"},
    {"metrica": "nos_orfaos_percentual", "condicao": "> 0.10", "severidade": "critical"},
    {"metrica": "latencia_travessia_p95", "condicao": "> 2000ms", "severidade": "warning"}
  ]
}
```

**Severidades:** Info (registro), Warning (acao em 48h), Critical (acao em 4h), Emergency (imediata).

## Latencia de Travessia

| Operacao | P50 | P95 | P99 maximo |
|----------|-----|-----|-----------|
| BFS (depth 3) | 15ms | 80ms | 200ms |
| DFS (depth 5) | 25ms | 120ms | 350ms |
| Shortest Path | 20ms | 100ms | 300ms |
| Neighborhood (nivel 2) | 10ms | 50ms | 150ms |

Alerta quando P95 excede threshold por mais de 10 minutos consecutivos.

## Dashboard de Observabilidade

1. **Saude geral:** Score com historico de 30 dias
2. **Metricas estruturais:** Nos, arestas, grau medio em tempo real
3. **Crescimento:** Grafico diario (ultimos 90 dias)
4. **Anomalias:** Alertas ativos com severidade
5. **Performance:** Latencia P50/P95 por operacao
6. **Utilizacao:** Recomendacoes/hora, taxa de aceitacao

**Atualizacao:** Estruturais a cada 5min, qualidade a cada 1h, alertas a cada 1min.

## Rotinas de Manutencao

**Diarias (automaticas):** Recalculo de metricas, verificacao de orfaos, coleta de latencia.

**Semanais (automaticas):** Recalculo de pesos, identificacao de clusters, limpeza de cache.

**Mensais (supervisionadas):** Revisao de orfaos, reindexacao, auditoria de consistencia.

**Trimestrais (supervisionadas):** Avaliacao arquitetural, reset de pesos com vies,
revisao de thresholds, benchmarking com carga real.
