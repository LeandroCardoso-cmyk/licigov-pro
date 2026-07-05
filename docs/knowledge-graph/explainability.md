# Explicabilidade do Grafo

## Principio Fundamental

Toda recomendacao gerada pelo Knowledge Graph deve ser **explicavel e rastreavel**.
O usuario nunca recebe uma sugestao sem entender de onde veio, por que foi sugerida
e qual a base legal que a sustenta.

> "Toda saida de IA deve ser: editavel, revisavel e validada por humano."

## Estrutura de Explicacao

Cada recomendacao inclui:
- **Nos utilizados:** Entidades que participaram da inferencia
- **Arestas percorridas:** Relacoes utilizadas com tipo, direcao e peso
- **Caminho completo:** Sequencia ordenada representando a cadeia de raciocinio
- **Justificativa textual:** Explicacao em linguagem natural
- **Score de confianca:** Valor numerico (0.0 a 1.0)

## Formato de Saida

```json
{
  "recommendation_id": "rec_2024_00123",
  "path": ["clausula:exigencia_atestado", "fundamenta:art67_ii", "lei:14133_2021"],
  "nodes": [
    {"id": "clausula:exigencia_atestado", "type": "clausula", "label": "Exigencia de atestado"},
    {"id": "lei:14133_2021_art67", "type": "artigo", "label": "Art. 67 - Qualificacao tecnica"}
  ],
  "edges": [
    {"from": "clausula:exigencia_atestado", "to": "lei:14133_2021_art67", "type": "fundamenta", "weight": 0.92, "confidence": 0.95}
  ],
  "reasoning": "Clausula fundamentada no Art. 67, inciso II da Lei 14.133/2021",
  "confidence": 0.92,
  "depth": 1,
  "traversal_time_ms": 12
}
```

## Niveis de Explicacao

### Resumo (1 linha)
Para tooltips, cards compactos e listagens.
```
"Fundamentado no Art. 67, II da Lei 14.133/2021 (confianca: 92%)"
```

### Detalhado (caminho completo)
Para paineis laterais e modais de detalhes.
```
Caminho: Clausula -> Art. 67, II -> Lei 14.133/2021
Justificativa: Exigencia prevista no Art. 67, inciso II.
Confianca: 92% | Profundidade: 1 | Nos visitados: 3
```

### Tecnico (scores e pesos)
Para desenvolvedores e auditoria avancada.
```
Score: 0.92 = weight(0.92) * confidence(0.95) * frequency(1.0) * context(1.02)
Algoritmo: shortest_path | Depth: 1 | Nos: 3 | Arestas avaliadas: 5
Tempo: 12ms | Cache hit: false | Timestamp: 2024-03-15T14:22:00Z
```

## Rastreabilidade Juridica

Toda recomendacao com base legal inclui referencia direta e navegavel:

```json
{
  "base_legal": {
    "lei": "14.133/2021",
    "artigo": 67,
    "inciso": "II",
    "texto_resumido": "documentacao relativa a qualificacao tecnico-profissional",
    "link_interno": "/knowledge/lei-14133/art-67",
    "contexto": "Para fins de habilitacao tecnica, podera ser exigido..."
  }
}
```

## Auditoria de Recomendacoes

### Dados registrados
- Timestamp, usuario, contexto completo (processo, documento, etapa)
- Recomendacao gerada (conteudo, tipo, explicacao completa)
- Acao do usuario (aceitar, rejeitar, ignorar, editar) com timestamp

### Retencao
- Logs de recomendacao: 2 anos (prazos de auditoria publica)
- Dados agregados: indefinido
- Dados pessoais: conforme LGPD

### Consultas disponiveis
- Historico por processo
- Taxa de aceitacao por tipo
- Recomendacoes rejeitadas com justificativa
- Evolucao dos pesos ao longo do tempo

## Interface de Visualizacao

- **Highlight de nos:** Nos participantes com cor diferenciada
- **Highlight de arestas:** Espessura proporcional ao peso
- **Animacao de caminho:** Travessia passo a passo
- **Tooltip:** Metadados ao passar o mouse
- **Zoom contextual:** Foco automatico na regiao relevante

## Conformidade com IA Explicavel (XAI)

1. **Transparencia:** Usuario sabe que IA gera recomendacoes
2. **Interpretabilidade:** Explicacoes compreensiveis por nao-tecnicos
3. **Rastreabilidade:** Todo resultado rastreavel ate sua origem
4. **Contestabilidade:** Usuario pode rejeitar e questionar
5. **Auditabilidade:** Registros completos para revisao externa
6. **Proporcionalidade:** Nivel de explicacao adequado ao impacto
