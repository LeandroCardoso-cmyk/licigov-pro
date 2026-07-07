# Institutional Request Engine — API de Integração

## API única

Todos os Business Domains integram com o Engine por **uma única API**:

```ts
requestInstitutionalReview({
  origin,      // Business Domain de origem (ex.: "licitacao")
  target,      // Business Domain de destino (ex.: "juridico")
  type,        // requestType (ex.: "LEGAL_OPINION_INITIAL")
  process,     // processo licitatório vinculado
  documents,   // referências de documentos (nunca cópias)
  context,     // contexto automático
})
```

**Nenhum domínio chama outro diretamente.** Todos usam **exatamente** esta API,
exposta pelo Kernel Service `institutional_request_engine` e obtida via
`kernelAccessService`. Internamente ela aciona o `institutionalRequestRouter`
(`createRequest`) e dispara a máquina de estados.

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `origin` | Domínio que abre a solicitação |
| `target` | Domínio que deve responder |
| `type` | Um dos request types (LEGAL_OPINION_INITIAL, CONTROL_REVIEW, …) |
| `process` | Identificação do processo (para vínculo e contexto) |
| `documents` | Lista de `documentReference` (origem/documento/versão/snapshot) |
| `context` | Objeto de contexto automático (ver abaixo) |

A chamada retorna o `requestId` (SHA-256 determinístico) e o `correlationId` para
acompanhamento e lineage.

## Contexto automático

Ao abrir a solicitação, o domínio destino recebe **automaticamente** todo o material
necessário — **nunca se obriga o usuário a procurar documentos**:

- **Processo** — dados do processo licitatório vinculado.
- **Documentos** — por referência (`documentReference`), com versão e snapshot.
- **Timeline** — histórico append-only da solicitação e do processo.
- **Histórico** — solicitações e respostas anteriores relacionadas.
- **Contexto** — metadados institucionais da demanda.
- **Reasoning** — raciocínio que motivou a solicitação.
- **Explainability** — justificativas rastreáveis das decisões.
- **Recomendações** — sugestões produzidas pelo Kernel cognitivo.
- **Riscos** — riscos identificados a serem observados pelo destino.

Isso elimina download, upload e duplicação: o destino abre a Inbox e já encontra
tudo pronto para analisar.

## Exemplo — Parecer Inicial

Fluxo canônico `Processo Licitatório → Parecer Inicial → retorno automático`:

```ts
// 1) Domínio Licitação abre a solicitação (origem)
const { requestId } = await requestInstitutionalReview({
  origin: "licitacao",
  target: "juridico",
  type: "LEGAL_OPINION_INITIAL",
  process: { id: "2026/0142" },
  documents: [
    { sourceDomain: "licitacao", documentId: "ETP-2026-0142", version: 3 },
    { sourceDomain: "licitacao", documentId: "TR-2026-0142",  version: 2 },
  ],
  context: { reasoning, explainability, riscos, recomendacoes },
});
```

```
Processo Licitatório
   │ requestInstitutionalReview(LEGAL_OPINION_INITIAL)
   ▼
Engine (Kernel) → status NEW → PENDING
   │ contexto automático (processo, docs, timeline, reasoning, riscos)
   ▼
Domínio Jurídico (Institutional Inbox)
   │ receiveRequest → assignRequest → respond
   ▼
Engine → status COMPLETED → RETURNED
   │ retorno automático (sem download/upload/duplicação)
   ▼
Processo Licitatório  ← recebe o Parecer assinado
```

O **Parecer assinado retorna automaticamente** ao Processo Licitatório. O campo
`signatureInfo` da resposta carrega apenas placeholders de assinatura
(manual, ICP-Brasil, GOV.BR, certificado A1) — assinatura real é ponto de extensão
futuro.

## Procedures do `institutionalRequestRouter`

| Procedure | Papel |
|---|---|
| `createRequest` | Cria a solicitação (`NEW → PENDING`) — usada por `requestInstitutionalReview()` |
| `assignRequest` | Atribui a usuário/setor/fila/prioridade |
| `receiveRequest` | Destino acusa recebimento (`PENDING → RECEIVED`) |
| `listPending` | Lista pendências do domínio |
| `listCompleted` | Lista solicitações finalizadas |
| `respond` | Registra a resposta (`IN_PROGRESS → COMPLETED`) |
| `returnRequest` | Retorno automático à origem (`COMPLETED → RETURNED`) |
| `archive` | Arquiva (`RETURNED → ARCHIVED`) |
| `getTimeline` | Retorna a timeline append-only |

## Garantias da integração

- **Multi-tenant**: `origin` e `target` sempre na **mesma organização**; jamais entre
  organizações distintas.
- **Replay safe**: `requestId` SHA-256 determinístico evita duplicação em reenvios.
- **Rastreável**: `correlationId` e lineage acompanham todo o ciclo.
- **Desacoplado**: origem e destino nunca se referenciam diretamente.
