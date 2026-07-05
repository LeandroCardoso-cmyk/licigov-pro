# Grounding Engine — Motor de Fundamentação

## Visão Geral

O Grounding Engine constrói o prompt enriquecido que será enviado ao provider de IA. Ele garante que nenhuma consulta seja processada sem fundamentação institucional.

## Sessão de Grounding

Cada consulta gera uma `GroundingSession` com:
- Grafo de evidências (nodes + edges)
- Prompt final enriquecido
- Score de grounding
- Score de confiança
- Replay snapshot (para reprodução determinística)
- Correlation ID (para rastreabilidade)

## Grafo de Evidências

```
EvidenceNode: { id, type, content, confidence, source }
EvidenceEdge: { from, to, relationship }

Relationships:
  supports    ─── uma evidência suporta outra
  contradicts ─── evidências conflitantes
  elaborates  ─── uma evidência detalha outra
  supersedes  ─── uma evidência substitui outra
```

## Hierarquia Legal

O grounding ordena evidências legais por autoridade:
1. Constituição Federal
2. Lei Complementar
3. Lei Ordinária (Lei 14.133/2021)
4. Decreto
5. Instrução Normativa
6. Outros

## Prompt Enriquecido

Estrutura do prompt final:
```
=== CONTEXTO INSTITUCIONAL ===
[contexto da organização]

=== LEGISLAÇÃO APLICÁVEL ===
[referências legais ordenadas por hierarquia]

=== EVIDÊNCIAS ===
[evidências ranqueadas por relevância]

=== DOCUMENTOS RELACIONADOS ===
[chunks recuperados]

=== CONSULTA ===
[query do usuário]
```

## Replay Safety

O `replaySnapshot` é um JSON determinístico de todas as entradas. `generateReplayKey` produz um hash SHA-256 dos inputs ordenados. Mesma entrada → mesmo hash → mesma saída.

## Score de Grounding

Calculado como média de confiança de todos os nós do grafo de evidências. Nodes sem confiança são contados como 0.
