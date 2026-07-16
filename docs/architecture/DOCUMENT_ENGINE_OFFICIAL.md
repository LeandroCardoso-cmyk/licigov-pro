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

> **RC-3.5.2:** o `documentConverter` é um **Internal Renderer** — implementação interna,
> **nunca API pública**. Toda chamada passa pelo Document Engine (`documentEngineService`),
> a **única fachada pública** de geração documental. Chamadas diretas ao converter só são
> permitidas para os Legacy Exporters registrados na allowlist central
> (`server/kernel/architecture/legacyBoundaries.ts`), garantido por teste de fronteira.

## Ciclo de vida via OfficialDocumentLifecycleService (RC-3.5.1)

A partir da RC-3.5.1, o Document Engine tem responsabilidade **única: gerar documentos**
(receber conteúdo → converter → renderizar → retornar artefato). Ele **NÃO** versiona,
**NÃO** registra timeline, **NÃO** faz upload, **NÃO** acessa Storage e **NÃO** conhece o
Amazon S3. Todo o ciclo de vida pertence ao **OfficialDocumentLifecycleService**.

```
Business Domain → Document Engine → OfficialDocumentLifecycleService → Storage Service → Amazon S3 → Signed URL → OfficialDocument
```

O Lifecycle Service faz `storagePut` do binário, obtém a **URL assinada** e grava as
**referências** no `OfficialDocument` (`storageKey`, `mimeType`, `size`, `hash`) — **nunca
binários no banco**. A **Storage Policy** (dentro do Storage Service) decide o fallback:
Base64 só em desenvolvimento/testes; produção/staging exigem storage (falha explícita).
Migration `0282_official_documents_storage_refs`. Detalhes em
[KERNEL_INFRASTRUCTURE.md](./KERNEL_INFRASTRUCTURE.md).

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
