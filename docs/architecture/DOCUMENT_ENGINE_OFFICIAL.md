# Document Engine — Componente Permanente do Cognitive Kernel (RC-3)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md) —
> "Os documentos são o principal produto do sistema." Todo documento oficial deve ser
> juridicamente robusto, padronizado, rastreável, editável, versionado e exportável.

A partir da RC-3, o **Document Engine** é o **pipeline ÚNICO e oficial** de geração de
documentos do LiciGov Pro. Nenhum Business Domain gera documentos diretamente: cada
domínio apenas informa **dados, conteúdo e tipo documental**; o Document Engine cuida do
resto. É um componente **permanente do Cognitive Kernel** (`document_engine`), acessado
exclusivamente via **Kernel Access Service** (`assertKernelAccess(domain, "document_engine")`).

## Pipeline único

```
Business Domain
   ↓  (dados, conteúdo Markdown, tipo)
OfficialDocument            (modelo uniforme)
   ↓
Template                    (business_domain_documentType)
   ↓
Versionamento               (nunca sobrescreve — nova versão por linhagem)
   ↓
Timeline documental         (append-only: criado / nova_versão / exportado)
   ↓
Exportação                  (DOCX + PDF binários reais)
```

## Modelo uniforme (`OfficialDocument`)

`server/domain/officialDocument.ts` — campos: `id`, `tenantId`, `businessDomain`,
`documentType`, `origin`, `title`, `version`, `status`, `template`, `content` (Markdown),
`metadata`, `author`, `lineageId`, `correlationId`, `replayHash`, `createdAt`, `updatedAt`.

- **`lineageId`** identifica a linhagem estável do documento (mesma origem+tipo → mesma
  linhagem; versões acumulam). **`replayHash`** é o hash determinístico de conteúdo+metadados.
- IDs via `sha256` — **replay-safe**; toda query filtra por `tenantId` — **multi-tenant**.

## Formatos oficiais

Obrigatórios: **DOCX** e **PDF** (binários reais via `documentConverter.convertToDOCX` /
`convertToPDF` — `docx` + `pdfkit`, sem Chromium). O Markdown é apenas representação
intermediária — **nunca** entregue como documento oficial final.

## Serviço e Router

- **Serviço:** `server/services/documentEngineService.ts`
  - `generateOfficialDocument(...)` — gera/versiona (Kernel-gated) + timeline.
  - `renderOfficialDocument(...)` — exporta DOCX/PDF (base64) + timeline (`documento_exportado`).
  - `previewOfficialDocument`, `listOfficialDocuments`, `listVersions`, `listDocumentTimeline`.
- **Router:** `documentEngine` (`server/routers/documentEngineRouter.ts`) — `generate`,
  `get`, `list`, `versions`, `timeline`, `preview`, `download`. `tenantProcedure`, multi-tenant.
- **Persistência:** tabelas `official_documents` (cada linha = uma versão) e
  `official_document_timeline` (append-only). Migrations 0280–0281.

## Integração dos Business Domains

| Domínio | Documentos oficiais |
|---|---|
| Processo Licitatório | ETP, TR, Edital (via `procurementProcessService`) |
| Contratação Direta | Justificativa da Contratação, Aviso, Ratificação, Extrato (via `directProcurementService`) |
| Parecer Jurídico | Parecer Inicial/Final (via `legalOpinionWorkspaceService`) |
| Contratos | Contrato, Aditivo, Apostilamento, Rescisão (via `contractService`) |
| **Centro de Operações** | **Não gera** — apenas **referencia** documentos (nunca duplica arquivos) |

Cada serviço de domínio delega a geração oficial a `generateOfficialDocument(...)`.

## Frontend (experiência única)

`client/src/components/documents/OfficialDocumentPanel.tsx` — componente compartilhado:
**Preview**, **Download DOCX**, **Download PDF**, **Versões** e **Informações**, idêntico em
qualquer módulo. O servidor percebe exatamente o mesmo comportamento para qualquer documento.

## Fora de escopo (Future Evolution)

Assinatura Digital, ICP-Brasil, Gov.br, editor online, colaboração simultânea, comentários,
aprovação/workflow documental e OCR **não** pertencem ao Document Engine nesta fase.
