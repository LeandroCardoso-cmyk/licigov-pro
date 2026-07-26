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
