# Governança — workspaceGovernanceRouter + Approval Layer

A governança do Workspace Cognitivo garante que todo o trabalho seja
**supervisionado por humanos**, **auditável** e **reproduzível**. Ela é exposta
pelo `workspaceGovernanceRouter` (tRPC) e apoiada pela **Approval Layer**
herdada das fases anteriores.

> Supervisão humana obrigatória. Auditabilidade total. Decisão sempre humana.

## Endpoints do `workspaceGovernanceRouter`

| Endpoint | Função |
|---|---|
| **assignParticipants** | Define os participantes e seus papéis no Workspace |
| **configureWorkspace** | Ajusta configuração operacional e políticas |
| **exportAudit** | Exporta a trilha de auditoria completa |
| **exportTimeline** | Exporta a linha do tempo institucional |
| **exportWorkspace** | Exporta o Workspace completo (estado + eventos) |
| **replayWorkspace** | Reconstrói o estado a partir dos eventos (replay) |
| **validateWorkspace** | Valida integridade e consistência do Workspace |
| **archiveWorkspace** | Arquiva o Workspace, tornando-o imutável |

Todos os endpoints exigem autenticação (`protectedProcedure`) e as operações
sensíveis exigem `adminProcedure`, com isolamento por `organizationId`.

## Participantes

`assignParticipants` define quem atua no Workspace e com quais permissões
(elaborar, revisar, aprovar, administrar). A composição de participantes é
registrada na timeline e determina quem pode aprovar decisões na Approval Layer.

## Configuração

`configureWorkspace` ajusta parâmetros operacionais — políticas de aprovação,
copilotos habilitados, regras de revisão. Toda alteração de configuração é
auditada e versionada na timeline.

## Approval Layer

A **Approval Layer** é a camada de aprovação humana obrigatória:

```
Recomendação (Orchestrator) ──▶ Decisão (createDecision)
                                      │
                                      ▼
                          Aprovação humana (approveDecision)
                                      │
                          participante com permissão adequada
                                      │
                                      ▼
                              Decisão efetivada
```

Nenhuma decisão é efetivada sem aprovação humana explícita. A aprovação é
registrada como evento imutável, com autor, timestamp e `correlationId`.

## Exportações

Três níveis de exportação atendem à auditoria:

- **exportAudit** — trilha de auditoria (quem, o quê, quando).
- **exportTimeline** — a linha do tempo institucional completa.
- **exportWorkspace** — o Workspace inteiro (estado consolidado + eventos),
  preservando IDs SHA-256 determinísticos.

As exportações permitem revisão por órgãos de controle sem acesso direto ao
sistema, com integridade verificável.

## Replay

`replayWorkspace` reconstrói o estado do Workspace a partir da sequência de
eventos append-only da timeline. Por causa dos IDs determinísticos, o replay é
**idempotente** (replay safety) e serve tanto para recuperação quanto para
verificação de integridade.

## Validação

`validateWorkspace` verifica a consistência do Workspace: encadeamento de
eventos, coerência de estados/estágios, decisões aprovadas por participantes
autorizados e ausência de riscos abertos bloqueantes. Divergências são
reportadas para correção antes do arquivamento.

## Arquivamento

`archiveWorkspace` move o Workspace para o estado **archived**, tornando-o
**imutável**. A partir daí ele serve apenas para consulta e auditoria; nenhuma
nova ação de escrita é permitida.

## Garantias

- **Supervisão humana**: aprovação sempre humana e explícita.
- **Auditabilidade total**: exportações completas e trilha imutável.
- **Determinismo**: replay reproduzível via IDs SHA-256.
- **Multi-tenant**: governança restrita ao `organizationId`.
- **Degradação graciosa**: sem DB (`getDb()`), operações são bloqueadas com erro
  explícito, preservando a integridade da trilha.

## Alinhamento legal

A governança materializa a exigência de **rastreabilidade e motivação** da
Lei 14.133/2021: cada decisão do Departamento de Licitações fica registrada,
justificada, exportável e reproduzível.
