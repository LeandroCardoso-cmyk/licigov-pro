# Pipeline comum de exportação de documentos (DOCX/PDF)

> Infraestrutura transversal introduzida na PR B, integrada nesta PR **apenas** ao
> Processo Licitatório (DFD, ETP, TR, Edital). Reutilizável pelos demais módulos via
> **adapters** (Contratos, Aditivos, Contratação Direta, Parecer Jurídico) — a serem
> implementados em PR futura, com autorização expressa.

## Arquitetura

```
Módulo (adapter)  →  documentExportService.exportDocument  →  [Document Engine.renderContent] → Buffer
                                                            →  [Storage Service.storagePut/signedUrl] → URL
```

- **Núcleo comum** `server/services/documentExportService.ts` — **módulo-agnóstico**.
  Recebe `{ organizationId, content, baseName, format, scope?, header? }`, delega a
  renderização ao Document Engine e o armazenamento ao Storage Service, devolvendo
  uma **URL assinada** de download. Não conhece Processo/Contrato/Parecer; não tem
  store próprio; sanitiza o nome-base (previne path traversal).
- **Fronteira RC-3.5.2 preservada:** o `DocumentConverter` é acionado **somente pelo
  Document Engine**. Por isso o núcleo usa `documentEngineService.renderContent`
  (primitiva genérica adicionada no Engine), nunca `convertToDOCX/PDF` direto.
- **Storage:** ponto único S3 (`storagePut` + `storageSignedUrl`), chave por tenant
  `exports/{scope}/{organizationId}/{ts}_{nome}.{ext}`.

## Adapter (contrato para os módulos)

Cada módulo fornece o **conteúdo já renderizado** do seu documento + nome-base +
cabeçalho institucional opcional. Exemplo (Processo Licitatório, já implementado —
`procurementProcessRouter.exportDocument`):

```ts
const doc = await getGeneratedDocumentByKind(processId, orgId, kind); // conteúdo do módulo
const exported = await exportDocument({
  organizationId, content: doc.content,
  baseName: `${kind.toUpperCase()}_${process.processNumber}`,
  format, scope: "processo",
});
```

**Regra:** o adapter vive no módulo (mapeia sua entidade → `{content, baseName}`);
o núcleo permanece sem dependência específica de módulo.

## Estruturas existentes nos demais módulos (levantamento)

| Módulo | O que já existe | Exportação parcial? | Reuso | Adapter necessário (próxima PR) |
|---|---|---|---|---|
| **Contratos** | `contractService` chama `generateOfficialDocument` (Document Engine); `contractDocuments.ts`, `contractReports.ts` | Sim — gera documentos oficiais | Document Engine + este pipeline | mapear documento de contrato → `{content, baseName, header}` (scope "contrato") |
| **Aditivos** | Parte de Contratos (`contractService`) | Parcial (via contrato) | idem Contratos | adapter de aditivo → `{content, baseName}` (scope "aditivo") |
| **Contratação Direta** | `directProcurementService` chama `generateOfficialDocument`; `insertGeneratedPublication` (publicações com `content`) | Sim — publicações | Document Engine + este pipeline | mapear publicação/documento → `{content, baseName}` (scope "contratacao_direta") |
| **Parecer Jurídico** | **`legalOpinionExportService.ts` já existe** (exportação dedicada); `legalOpinionWorkspaceService` chama `generateOfficialDocument` | **Sim — exportação própria** | consolidar sobre este núcleo | migrar `legalOpinionExportService` para delegar ao núcleo comum (scope "parecer") |

**Observações:**
- Vários módulos já produzem documentos **oficiais** via `generateOfficialDocument`
  (store `official_documents`), que possuem o caminho `renderOfficialDocument`
  (render por `documentId`). Para esses, o adapter pode: (a) usar
  `renderOfficialDocument` quando o documento estiver no store oficial; ou (b) usar
  `documentExportService` quando o conteúdo estiver em outra tabela (ex.:
  `generated_documents` do canônico, `generated_publications`).
- **Parecer Jurídico** já tem exportação parcial (`legalOpinionExportService`) — o
  adapter futuro consolida essa lógica sobre o núcleo comum, evitando duplicação.

## Pontos de extensão

- `ExportFormat` = `"docx" | "pdf"` (ampliável no núcleo se necessário).
- `header` (cabeçalho institucional) é genérico e opcional.
- `scope` isola as chaves por módulo no storage.
- Novos formatos/planos (ex.: XLSX de relatórios) entram como novas primitivas no
  Document Engine + variantes no núcleo — sem tocar nos adapters.

## Não incluído nesta PR

- Implementação dos adapters de Contratos/Aditivos/Contratação Direta/Parecer
  (aguarda autorização expressa).
- Persistência de histórico/auditoria de exportação dedicada (há
  `official_exports`/ExportCenter no projeto; integração é evolução).

---

## PR B.1 — Exportação institucional nos demais módulos (entregue)

**Achado da Fase 0 (Graphify + código):** os 4 módulos convergem para a tabela única
`official_documents` (content Markdown, `status` gerado/revisado/emitido, `version`,
`origin`, `documentType`). Não há 4 pipelines — há **um** adapter compartilhado.

### Adapters implementados
- **Adapter compartilhado** `server/services/officialDocumentExportAdapter.ts`
  (`exportOfficialDocument`): dado um `OfficialDocument`, mapeia status/tipo/metadados
  → `InstitutionalMeta` e delega ao núcleo comum (`documentExportService.exportDocument`
  → `renderInstitutionalContent` + S3 + URL assinada). Serve **Contratos, Aditivos,
  Contratação Direta e Parecer-workspace**. LEITURA apenas (não gera/versiona/altera
  status). Exposto por `documentEngine.exportInstitutional` (tenantProcedure; flag
  `inline` → impressão).
- **Parecer legado (façade)** `legalOpinionExportService.ts`: deixou de ter renderer
  próprio (pdfkit/docx) — agora delega a `renderInstitutionalContent`. Contrato público
  preservado (Buffer; router/cliente base64 inalterados). Remove o desvio RC-3.5.2.

### UI (superfícies canônicas)
- **Contratos:** `ContractWorkspace` já montava `OfficialDocumentPanel` → ganhou
  DOCX/PDF institucional + **Imprimir** automaticamente (painel aprimorado).
- **Contratação Direta:** `OfficialDocumentPanel` montado em `PublicationWorkspace`
  (origin = workspaceId), read-only (não dispara `publish`).
- **Parecer:** detalhe legado (`LegalOpinionDetails`/`LegalOpinionHeader`) — DOCX/PDF
  agora institucionais (façade) + botão **Imprimir** (PDF inline).
- `OfficialDocumentPanel`: Baixar DOCX/PDF (URL assinada, nome legível) + **Imprimir**
  (PDF inline, sem chrome da app) + Preview; tokens semânticos (light/dark).

### Impressão
Sem renderer divergente: usa o **PDF institucional** aberto **inline** (Content-Disposition
`inline` na URL assinada) — sem sidebar/nav/botões da aplicação.

### Nomes de download
Determinísticos e legíveis (ex.: `CONTRATO_012-2026_gerado_v3.pdf`), a partir do número
em `metadata` + status + versão; **sem** timestamp, UUID interno, tenantId/organizationId.
Chave interna do storage (linhagem) separada do nome de download.

### Lacunas reportadas (fora do escopo — não fabricadas)
- **Contratos/Aditivos legados** (`contract_documents`, telas `ContractDetails`): Markdown-only,
  **sem** `official_documents` → não exportáveis institucionalmente sem dual-write/migração
  de tela (proibido nesta PR). Ficam no download `.md` legado.
- **Contratação Direta:** `instrucoes`/`cronograma` colapsam em `aviso` no documento oficial;
  `justificativa_preco` (estruturada) não gera `official_documents`. `generated_publications`
  é shadow redundante (sem status; content não exposto). Não exportados isoladamente.
- **Parecer-workspace (FASE 5):** o backend já exporta seus `official_documents` pelo adapter;
  a superfície de UI dedicada por parecer no workspace fica como evolução (o detalhe legado
  cobre o fluxo hoje).

Sem migration. Segurança/tenant/auditoria preservadas; conteúdo buscado no backend.
