# Colaboração — workspaceCollaborationService

O `workspaceCollaborationService` coordena a **colaboração humana** dentro do
Workspace Cognitivo e a **interação entre servidores e copilotos**. É a camada
que garante que o trabalho seja feito em equipe, com revisão, aprovação e
rastreabilidade — sempre com a **decisão final humana**.

> O Workspace coordena pessoas e copilotos no mesmo ambiente operacional.

## Responsabilidades

| Função | Descrição |
|---|---|
| **Comentários** | Discussão contextual em tarefas, decisões e documentos |
| **Revisão colaborativa** | Múltiplos servidores revisam a mesma entrega |
| **Marcações** | Menções e sinalizações direcionadas a participantes |
| **Aprovação humana** | Registro formal de aprovação (Approval Layer) |
| **Delegação** | Transferência de responsabilidade sobre tarefas |
| **Notificações internas** | Alertas de eventos relevantes aos participantes |

## Comentários

Comentários são vinculados a um alvo (`workspaceTask`, `workspaceDecision` ou
documento) e ao Workspace. Cada comentário carrega autor, timestamp,
`organizationId` e `correlationId`, e gera um evento na `workspaceTimeline`.
São imutáveis após a criação, preservando o histórico da discussão.

## Revisão colaborativa

Quando uma tarefa entra em `in_review`, o serviço permite que os participantes
designados revisem a entrega. A revisão pode:

- **aprovar** → a tarefa segue para `done` (via `concludeTask`);
- **solicitar ajustes** → a tarefa retorna a `in_progress`;
- **registrar observações** → comentários persistidos na timeline.

A revisão colaborativa é o ponto onde as **recomendações consolidadas** do
Orchestrator são avaliadas por humanos antes de virarem decisão.

## Marcações e menções

Participantes podem ser marcados em comentários e tarefas. Cada marcação dispara
uma notificação interna e é registrada, permitindo auditar quem foi acionado e
quando.

## Aprovação humana (Approval Layer)

A aprovação é sempre **humana e explícita**. O serviço integra-se à
**Approval Layer** herdada das fases anteriores: uma decisão (`workspaceDecision`)
só é efetivada por `approveDecision`, executado por um participante com
permissão adequada (`protectedProcedure`/`adminProcedure`). Nenhuma aprovação é
automatizada.

## Delegação

A responsabilidade por uma tarefa pode ser delegada a outro participante. A
delegação:

- mantém o histórico do responsável anterior;
- registra autor, destinatário e motivo na timeline;
- não altera o estado da tarefa, apenas seu responsável.

## Notificações internas

Eventos relevantes — nova marcação, tarefa bloqueada, decisão aguardando
aprovação, risco aberto — geram notificações internas aos participantes. As
notificações são derivadas da timeline, garantindo consistência com o registro
auditável.

## Coordenação usuários + copilotos

O diferencial da colaboração no Workspace é integrar, no mesmo ambiente:

- **Servidores** — que revisam, comentam, delegam e aprovam;
- **Copilotos** — que produzem recomendações via Orchestrator.

```
Copilotos ──▶ Recomendação consolidada ──▶ Revisão colaborativa (humana)
                                                 │
                                    comentários · marcações · ajustes
                                                 │
                                                 ▼
                                        Aprovação humana ──▶ Decisão
```

O copiloto propõe; o servidor comenta, ajusta e aprova. A colaboração garante
que a inteligência aplicada seja sempre **supervisionada**.

## Garantias

- **Rastreabilidade**: cada comentário, revisão, delegação e aprovação vira
  evento imutável na `workspaceTimeline`.
- **Multi-tenant**: colaboração restrita ao `organizationId` do Workspace.
- **Determinismo**: eventos com IDs SHA-256, compatíveis com replay.
- **Degradação graciosa**: sem DB (`getDb()`), operações de escrita são
  bloqueadas com erro explícito.
- **Supervisão humana**: aprovação e decisão nunca são delegadas a copilotos.
