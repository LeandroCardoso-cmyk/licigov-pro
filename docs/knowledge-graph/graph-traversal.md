# Navegacao no Grafo

## Visao Geral

Este documento descreve os algoritmos e estrategias de travessia utilizados no Knowledge Graph
do LiciGov Pro para encontrar relacoes entre entidades juridicas, documentos e bases legais.

## Algoritmos de Travessia

### BFS — Busca em Largura

Explora todos os vizinhos de um no antes de avancar para o proximo nivel.
Utilizada para encontrar **todas as conexoes diretas** de uma entidade.

**Casos de uso:** encontrar artigos relacionados a uma clausula, listar documentos
que referenciam um processo, identificar requisitos imediatos de uma modalidade.

**Parametros:** `start_node`, `max_depth` (padrao: 3), `node_types` (filtro opcional).

### DFS — Busca em Profundidade

Segue um caminho ate o fim antes de retroceder. Utilizada para **cadeias de dependencia**.

**Casos de uso:** rastrear fundamentacao legal completa, encontrar derivacao DFD-Edital,
identificar dependencias transitivas entre requisitos.

**Parametros:** `start_node`, `max_depth` (padrao: 5), `visited` (controle de ciclos).

## Caminho Mais Curto (Shortest Path)

Encontra a rota com menor custo entre duas entidades usando variacao de Dijkstra.

**Formula de custo:** `custo(aresta) = 1 / (peso * confianca)`

Quanto maior o peso e a confianca, menor o custo, priorizando relacoes mais fortes.

## Travessia Ponderada

Considera o peso das arestas para priorizar caminhos relevantes. Atributos por aresta:
- `weight` (0.0-1.0): Forca da relacao
- `confidence` (0.0-1.0): Confiabilidade
- `frequency` (0.0-1.0): Frequencia historica de uso

**Scoring:** `score_caminho = produto(weight_i * confidence_i)` para cada aresta no caminho.

## Expansao de Vizinhanca

Explora o entorno de um no progressivamente, revelando conexoes nao obvias.

**Niveis:** 1 (vizinhos diretos), 2 (vizinhos dos vizinhos), 3 (cluster tematico).

**Filtros:** por tipo de relacao, tipo de no, ou peso minimo da aresta.

## Explicabilidade da Travessia

Toda travessia retorna um objeto de explicacao:

```json
{
  "path": ["no_origem", "no_intermediario", "no_destino"],
  "nodes_visited": ["no1", "no2", "no3"],
  "edges_traversed": [
    {"from": "no1", "to": "no2", "type": "fundamenta", "weight": 0.9}
  ],
  "reasoning": "Clausula X fundamentada no Art. 18 via relacao direta de peso 0.9",
  "total_score": 0.85,
  "depth_reached": 2
}
```

## Limites de Profundidade

| Operacao | max_depth padrao | max_depth maximo |
|----------|-----------------|-----------------|
| BFS | 3 | 5 |
| DFS | 5 | 8 |
| Shortest Path | 6 | 10 |
| Neighborhood | 2 | 4 |

**Regras de timeout:** travessias que excedem 2 segundos sao interrompidas, resultados
parciais retornados com `truncated: true`, travessias lentas logadas para otimizacao.

## Cache de Travessias Frequentes

- **TTL padrao:** 1 hora para travessias de base legal
- **TTL curto:** 15 minutos para documentos em edicao
- **Invalidacao:** Quando nos ou arestas envolvidos sao modificados
- **Chave de cache:** `hash(start_node + end_node + params)`

## Exemplos Praticos

### Encontrar base legal para clausula X

```
Entrada: clausula "Exigencia de atestado de capacidade tecnica"
Algoritmo: Shortest Path
Resultado: Clausula -> Art. 67, inciso II -> Lei 14.133/2021
Score: 0.92
```

### Quais documentos referenciam artigo Y

```
Entrada: Art. 18 da Lei 14.133/2021
Algoritmo: BFS (depth=1, tipo=documento)
Resultado: [ETP-2024/001, ETP-2024/015, TR-2024/008]
```

### Encontrar requisitos relacionados a modalidade

```
Entrada: Modalidade "Pregao Eletronico"
Algoritmo: Neighborhood Expansion (nivel=2)
Resultado: 12 requisitos obrigatorios, 5 recomendados
Score medio: 0.78
```
