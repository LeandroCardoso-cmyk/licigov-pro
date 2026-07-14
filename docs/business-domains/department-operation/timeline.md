# Área 4 — Timeline Operacional

> Histórico completo do departamento: **quem / quando / o quê**. Append-only, nunca editável.

## Propósito

A Timeline Operacional é a **memória institucional** do Centro de Operações. Registra cada
ação relevante para dar **rastreabilidade total** ao acompanhamento — requisito não
negociável do LiciGov Pro (auditoria, logs, versionamento).

Ela **reutiliza** o motor **Timeline** do Kernel — não reimplementa histórico próprio.

## Modelo append-only

Cada entrada é **imutável**:

- **Nunca é editada.**
- **Nunca é apagada.**
- Correções entram como **novos eventos**, jamais sobrescrevendo os anteriores.

Isso garante que o histórico seja auditável e que nenhuma informação de rastreabilidade se
perca.

## Anatomia de uma entrada

| Campo | Descrição |
|---|---|
| **Quem** | Autor da ação (usuário ou sistema), com identidade do tenant |
| **Quando** | Carimbo temporal preciso |
| **O quê** | Descrição da ação e referência à entidade afetada |
| **Contexto** | Domínio de origem, tipo de marco, valores antes/depois quando aplicável |

## O que a Timeline registra

- Atualização de **marcos operacionais** (automáticos e manuais) no Painel.
- Criação/alteração de **eventos** do calendário.
- Emissão de **alertas de vencimento** (90/60/30/15/7 dias).
- Criação e edição de **OperationRecord** (legados e externos).
- **Importação assistida** confirmada pelo servidor (origem externa).
- **Recomendações** apresentadas pelo Adaptive Recommendation Engine.
- Ações da **Caixa de Entrada** (Área 5): conclusão de tarefas, aprovações, revisões.

## Explainability e observabilidade

A Timeline é o substrato de **explainability** do domínio: qualquer decisão consolidada,
alerta disparado ou recomendação exibida pode ser rastreada até sua origem, com autoria e
horário. É também o principal ponto de **observabilidade** operacional.

## Replay-safe

Como todos os identificadores derivam de `sha256` determinístico, **reprocessar** as fontes
**não duplica** entradas: um mesmo evento de origem sempre produz a mesma entrada de timeline
(idempotência). Isso permite reconstruir o histórico com segurança.

## Multi-tenant

Cada entrada pertence a um único tenant. Nenhuma consulta de timeline cruza fronteiras entre
departamentos.

## Relação com as demais áreas

- **Área 2 (Painel):** cada edição manual de marco gera uma entrada aqui.
- **Área 3 (Calendário):** criação/alteração de eventos e alertas são registrados.
- **Área 5 (Caixa de Entrada):** ações do usuário sobre suas pendências ficam rastreadas.
