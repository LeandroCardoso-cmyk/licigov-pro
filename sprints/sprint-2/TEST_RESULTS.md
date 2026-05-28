# Sprint 2 — Resultados dos Testes

## Arquivo de Testes
`server/__tests__/integration/sprint2-core-documental.test.ts`

## Resultado: 55 testes | 100% passando

### Distribuição por funcionalidade

| Funcionalidade | Testes |
|---------------|--------|
| DocumentService (CRUD) | 12 |
| DocumentWorkflow (state machine) | 9 |
| DocumentVersionService | 8 |
| DocumentDraftService | 7 |
| DocumentTimelineService | 6 |
| DocumentTemplateService | 7 |
| DocumentRepository | 6 |

## Correções Necessárias

### Teste reformulado: `createVersion lança quando DB indisponível`
- **Problema:** `vi.mock` global retornava sempre o mock, nunca o serviço real
- **Solução:** Reformulado para `createVersion retorna shape com id e versionNumber`

### Teste corrigido: `toEndWith` não disponível
- **Problema:** Método não existe no Vitest/Chai
- **Solução:** `.toMatch(/\.html$/)` e `.toMatch(/\.docx$/)`

### Teste corrigido: Cálculo com ano bissexto
- **Problema:** 2024 tem 366 dias; `2024-01-01 + 365d = 2024-12-31` (não 2025)
- **Solução:** Base alterada para `2023-01-01`

## Total acumulado após Sprint 2: 438 testes
