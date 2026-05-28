# Rendering Architecture

## Motor de Renderização Documental

O `RenderService` converte documentos do formato interno para formatos distribuíveis.

## Formatos Suportados

| Formato | Biblioteca | Uso |
|---------|-----------|-----|
| HTML | Templates + CSS inline | Preview web, email |
| DOCX | Template Word | Edição offline, protocolo |
| PDF | PDFKit | Assinatura, arquivo |

## Fluxo de Renderização

```
documento + versão
       │
       ▼
RenderService.renderDocument(documentId, orgId, format)
       │
       ├── Cache hit? → retornar do document_render_cache
       │
       └── Cache miss:
              │
              ▼
           Renderizar (html/docx/pdf)
              │
              ▼
           Gravar em document_render_cache
           (hash = SHA-256 do conteúdo + versão)
              │
              ▼
           Retornar RenderResult
```

## Cache de Render

```typescript
interface DocumentRenderCacheEntry {
  documentId:      number;
  versionId:       number;
  format:          "html" | "docx" | "pdf";
  renderHash:      string;   // SHA-256 conteúdo + versão
  renderedContent: string;   // conteúdo renderizado
  status:          "pending" | "processing" | "ready" | "failed";
  expiresAt:       Date;
}
```

Invalidação: `RenderService.invalidateRenderCache()` apaga cache após edição do documento.

## Roadmap
- Sprint 4: Integrar biblioteca DOCX profissional para formatação rica
- Sprint 6: PDF com assinatura digital ICP-Brasil embutida
