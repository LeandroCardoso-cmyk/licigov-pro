# Área 3 — Calendário Operacional

> Acompanha **EVENTOS**, não workflow. É a agenda operacional do departamento de licitações.

## Princípio fundamental: eventos ≠ workflow

O Calendário Operacional existe para responder **"o que acontece e quando"**. Ele lida com
**eventos que ocupam uma data/hora** — não com etapas de processo, documentos ou tramitação.

- **Workflow** (etapas, publicações, checklist, TR, edital, parecer, documentos) → pertence
  aos Business Domains e ao **Painel de Acompanhamento** (Área 2).
- **Eventos** (algo que acontece em um momento) → pertence ao **Calendário** (Área 3).

## O que o calendário MOSTRA

- **Sessões públicas** e **certames**.
- **Reuniões**, **audiências** e **visitas técnicas**.
- **Assinaturas** (de contratos, aditivos, atas).
- **Vencimentos** de **contratos**, **aditivos** e **atas**.
- **Tarefas** com data.
- **Eventos manuais** (cadastrados via OperationRecord — reunião, evento).

## O que o calendário NÃO MOSTRA

Estes pertencem ao **workflow** e **nunca** aparecem no calendário:

- **Publicações** (PNCP, Órgão Oficial, Diário Oficial, Portal, Jornal) — são status + data
  no Painel, **não** eventos de agenda.
- **Checklist**, **TR**, **Edital**, **Parecer**.
- **Documentos** em geral.

## Vencimentos são automáticos

Contratos, aditivos e atas **geram automaticamente** um evento de vencimento assim que
existem. Junto ao evento, o sistema dispara **alertas escalonados**:

```
90 dias  →  60 dias  →  30 dias  →  15 dias  →  7 dias  →  vencimento
```

> Eventos de vencimento **nunca são cadastrados manualmente** — nascem sempre do dado de
> origem (contrato/aditivo/ata). Isso evita divergência e duplicação.

## Visualizações

- **Diária** — foco no dia, hora a hora.
- **Semanal** — visão da semana operacional.
- **Mensal** — grade do mês, para planejamento.

## Interação

Clicar em um evento **abre o processo** relacionado (contratação, contrato, tarefa ou
registro de origem), levando o usuário direto ao contexto completo.

## Origem dos eventos

| Tipo de evento | Origem |
|---|---|
| Sessão pública / certame | Processo Licitatório / Contratação Direta |
| Vencimento de contrato/aditivo/ata | Contratos (automático + alertas) |
| Assinatura | Contratos / marco manual externo |
| Tarefa | Tarefas do departamento |
| Reunião / audiência / visita técnica | Manual (OperationRecord) |
| Evento manual | OperationRecord |

## Garantias

- **Multi-tenant**: cada departamento vê apenas sua própria agenda.
- **Replay-safe** (IDs `sha256`): reprocessar contratos/aditivos/atas **não duplica** eventos
  de vencimento nem reenvia alertas já emitidos.
- Toda criação/alteração de evento é registrada na **Timeline Operacional** (Área 4).
