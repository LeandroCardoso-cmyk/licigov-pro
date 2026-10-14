# OperationRecord — Processos Legados e Registros Externos

> Mecanismo para registrar itens que **não nasceram no LiciGov Pro** — legados e externos —
> sem obrigar reconstrução completa e sem duplicar dados existentes.

## O conceito OperationRecord

O `OperationRecord` é uma entidade do `operationRecordRouter` que representa manualmente um
item que o Centro de Operações precisa **acompanhar**, mas que **não** foi criado por um
Business Domain do sistema.

### Tipos

- Processo Licitatório Legado
- Contratação Direta Legada
- Contrato Externo
- Aditivo Externo
- Ata Externa
- Parecer Externo
- Reunião
- Evento
- Tarefa
- Outro

### Origem

| Origem | Significado |
|---|---|
| **Interna** | Registrado manualmente por um usuário do departamento |
| **Externa** | Resultante de importação assistida confirmada pelo servidor |

## Processos legados (OBRIGATÓRIO)

O suporte a legados é **obrigatório**. Departamentos que já operam há anos precisam trazer o
que existe **sem** refazer tudo.

> **Regra:** nunca obrigar a reconstrução completa de um processo. É permitido cadastrar o
> processo **completo** OU **apenas partes** — só o contrato, só o aditivo, só a reunião, só
> um parecer, etc.

Partes ausentes aparecem no Painel de Acompanhamento como **Cinza (não iniciado)**, sem
travar o acompanhamento do que existe.

## Dois caminhos de cadastro

### 1. Cadastro Rápido

Formulário mínimo para registrar o essencial:

- Número
- Objeto
- Modalidade
- Etapa atual
- Responsável
- Documentos (**opcionais**)

Rápido por design — captura o suficiente para a contratação entrar no acompanhamento.

### 2. Importação Assistida

Fluxo determinístico a partir de arquivo:

```
PDF / DOCX  →  extração determinística  →  servidor confirma  →  registra (Origem Externa)
```

- A **extração é determinística** (mesmo arquivo → mesmo resultado).
- O **servidor sempre confirma** antes de registrar — nada é aceito cegamente.
- O registro final recebe **Origem Externa** e fica rastreado na Timeline.

## Marcos operacionais manuais

Para legados e externos, o preenchimento de marcos segue a **mesma regra de ouro** do Painel:

> Preenchimento manual **apenas** para informações **externas ao sistema** — data do certame,
> hora, resultado, homologação, assinatura. **Nunca duplicar** dado que já exista em um
> Business Domain.

## Publicações, contratos e vencimentos

- **Publicações** dos legados seguem o mesmo modelo do Painel: **status + data** apenas, nos
  canais configuráveis (PNCP padrão). Não viram eventos de calendário.
- **Contratos, aditivos e atas externos** (Contrato Externo, Aditivo Externo, Ata Externa)
  geram **automaticamente** evento de vencimento + alertas (90/60/30/15/7 dias), exatamente
  como os nativos, **quando o término da vigência é informado** no Cadastro Rápido (campo
  opcional, exibido só para esses três tipos; `operationRecord.createRecord.expirationDate`).
  **Nunca cadastrados manualmente** como evento. Sem término informado, o registro fica só em
  acompanhamento, sem alertas.
- O indicador "contratos vencendo" conta **contratos** (um por referência) com vencimento nos
  próximos 90 dias — os alertas do mesmo vencimento não inflam o número.

## Garantias

- **Multi-tenant**: registros isolados por departamento.
- **Replay-safe** (IDs `sha256`): reimportar o mesmo arquivo não cria registros duplicados.
- **Rastreabilidade**: criação, importação e edição registradas na Timeline (Área 4).

## Promoção a contrato completo (sem alerta duplicado)

Um registro `contrato_externo` (cadastro rápido, já monitorado) pode ser a origem de um contrato vigente no
Contract Workspace (`registerInForceContract` com `legacyRecordId`). O vínculo grava `reference_type=contract_workspace`
e o término de vigência existente é **transferido** para o contrato (`vigencia_transferida` → `registro_vinculado_contrato`
na timeline): os eventos derivados são identificados por `(órgão, tipo, referência, data, offset)`, portanto o mesmo
vencimento nunca gera alerta em dobro e o KPI de contratos a vencer conta o contrato uma única vez. Aditivo de prazo
com `newEndDate` reagenda os eventos automáticos (`replaceExpirationEvents`), preservando eventos manuais.
