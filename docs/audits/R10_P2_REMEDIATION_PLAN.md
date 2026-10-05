# R10 — Plano de remediação dos P2 (12/12)

> Estado: **EXECUTADO LOCALMENTE (2º passe) — IMPLEMENTED_PENDING_REVIEW** (sem PR/merge/deploy; atualizado em 2026-10-05) · gerado programaticamente do baseline
> `docs/audits/SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` (sha256 `08edc7344c9038889978e1b2f9204f4fd523e3fef36e6b29b47ff324ae0810b3`, não modificado). 12 P2 verificados no gerador. **Placar (2026-10-05):** 9 IMPLEMENTED_PENDING_REVIEW · 2 PARTIAL_LOCAL · 1 BLOCKED_LEGAL_REVIEW = 12.

| SEM | Achado (baseline) | Evidência | Ação proposta | Migration | Estado / dependência |
|---|---|---|---|---|---|
| SEM-037 | `writePlannedQuantity` grava no ledger via `appendContextFacts` direto, contornando a checagem de política de `recordContextAssertions` | writePlannedQuantity, appendContextFacts, recordContextAssertions | `writePlannedQuantity` via `recordContextAssertions` (checagem de política) | Não | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-038 | Política permite `intelligent_item` como fonte de descrição/unidade, mas não há escritor — autoridade morta/ambígua. | intelligent_item | Remover `intelligent_item` como fonte permitida de descrição/unidade (ou criar o escritor) | Não | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-044 | Edição humana não deixa marcador; ETP reescrito por humano aparece como "gerado" | db/procurement.ts:587-590, authoringContext.ts:353-357 | Marcador de edição humana no rascunho (origem "manual") | Não | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-045 | Descrição/unidade do item canônico sempre projetadas como `user/confirmed` (proveniência achatada) | user/confirmed, canonicalProcurementContext.ts:343-344 | Proveniência real de descrição/unidade do item canônico | Não | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-046 | Activity report lê campos inexistentes (`userName`, `description`) → tudo "Sistema"; `download.*` grava logs sem `organizationId` | userName, description, download.* | Activity report com campos reais; logs de download com organizationId | Não | IMPLEMENTED_PENDING_REVIEW `bc74f6f` |
| SEM-061 | "Substituir rascunho" (import) confirma sem mostrar o conteúdo atual; CATMAT "Confirmar" sem decisão vigente; limiar CATMAT sem confirmação de impacto org-wide. |  | Substituir rascunho mostra o atual; CATMAT "Confirmar" exige decisão vigente; limiar com impacto | Não | IMPLEMENTED_PENDING_REVIEW `4037745` (confirmação de limiar só na UI; política de limiar não decidida) |
| SEM-087 | SoD da emissão exclui só autor e **último** editor; `issueProcess` não exige ETP/TR emitidos. | issueProcess | SoD da emissão: todos os editores substantivos; `issueProcess` exige ETP/TR emitidos | Não | PARTIAL_LOCAL `d6904da` (parte B: `issueProcess` exige ETP/TR/Edital emitidos; parte A, escopo da SoD: BLOCKED_HUMAN_DECISION) |
| SEM-088 | `tenantIsolationAuditService` avalia registros fornecidos pelo chamador (não varre o banco) — falsa sensação de cobertura. | tenantIsolationAuditService | `tenantIsolationAuditService` varre o banco (ou é renomeado como verificador de amostra) | Não | IMPLEMENTED_PENDING_REVIEW `bc74f6f` |
| SEM-089 | `dfdj:${key}`.slice(0,64) pode colidir chaves longas. | dfdj:${key} | Chave `dfdj:` por hash completo (sem truncar) | Não | IMPLEMENTED_PENDING_REVIEW `d6904da` |
| SEM-090 | Quantidade nula gravada como 0 na promoção (0 entra na chave lógica). |  | Quantidade nula ≠ 0 na promoção (fora da chave lógica) | Não | PARTIAL_LOCAL `d6904da` (quantidade nula ≠ 0 no domínio e nos documentos; o token "0" da chave lógica persistida exige migração versionada de chave) |
| SEM-091 | Credenciamento inexistente como regime; prompt de parecer legado lê `legalArticle` inexistente. | legalArticle | Credenciamento como regime (se o órgão usar) e prompt do parecer legado sem `legalArticle` inexistente | Não | BLOCKED_LEGAL_REVIEW (J-5) |
| SEM-092 | Componente `WorkspaceDecisionPanel` com decisões fictícias ("Ana Souza", "Carlos Lima") como default — sem consumidor hoje (risco se reutilizado). | WorkspaceDecisionPanel | `WorkspaceDecisionPanel` sem defaults fictícios (ou removido) | Não | IMPLEMENTED_PENDING_REVIEW `bc74f6f` |

## LEG-007 (UI morta) e LEG-031 (redirects)

- **LEG-007**: componentes de UI sem rota/consumidor (ex.: `WorkspaceDecisionPanel`, SEM-092) — remover ou isolar; não
  removidos nesta branch (decisão de produto sobre reaproveitamento). Inventário: `docs/audits/R2_LEGACY_REACHABILITY_INVENTORY.md`.
- **LEG-031**: os redirects de rotas legadas para as canônicas **permanecem** (não removidos), conforme o plano.
