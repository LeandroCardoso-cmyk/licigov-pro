# R10 — Plano de remediação dos P2 (12/12)

> Estado: **PLAN_PREPARED_AWAITING_HUMAN_APPROVAL** · gerado programaticamente do baseline
> `docs/audits/SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` (sha256 `08edc7344c9038889978e1b2f9204f4fd523e3fef36e6b29b47ff324ae0810b3`, não modificado). 12 P2 verificados no gerador.

| SEM | Achado (baseline) | Evidência | Ação proposta | Migration | Estado / dependência |
|---|---|---|---|---|---|
| SEM-037 | `writePlannedQuantity` grava no ledger via `appendContextFacts` direto, contornando a checagem de política de `recordContextAssertions` | writePlannedQuantity, appendContextFacts, recordContextAssertions | `writePlannedQuantity` via `recordContextAssertions` (checagem de política) | Não | PLAN |
| SEM-038 | Política permite `intelligent_item` como fonte de descrição/unidade, mas não há escritor — autoridade morta/ambígua. | intelligent_item | Remover `intelligent_item` como fonte permitida de descrição/unidade (ou criar o escritor) | Não | PLAN |
| SEM-044 | Edição humana não deixa marcador; ETP reescrito por humano aparece como "gerado" | db/procurement.ts:587-590, authoringContext.ts:353-357 | Marcador de edição humana no rascunho (origem "manual") | Não | PLAN |
| SEM-045 | Descrição/unidade do item canônico sempre projetadas como `user/confirmed` (proveniência achatada) | user/confirmed, canonicalProcurementContext.ts:343-344 | Proveniência real de descrição/unidade do item canônico | Não | PLAN |
| SEM-046 | Activity report lê campos inexistentes (`userName`, `description`) → tudo "Sistema"; `download.*` grava logs sem `organizationId` | userName, description, download.* | Activity report com campos reais; logs de download com organizationId | Não | PLAN |
| SEM-061 | "Substituir rascunho" (import) confirma sem mostrar o conteúdo atual; CATMAT "Confirmar" sem decisão vigente; limiar CATMAT sem confirmação de impacto org-wide. |  | Substituir rascunho mostra o atual; CATMAT "Confirmar" exige decisão vigente; limiar com impacto | Não | PLAN |
| SEM-087 | SoD da emissão exclui só autor e **último** editor; `issueProcess` não exige ETP/TR emitidos. | issueProcess | SoD da emissão: todos os editores substantivos; `issueProcess` exige ETP/TR emitidos | Não | PLAN (decisão humana sobre o escopo da SoD) |
| SEM-088 | `tenantIsolationAuditService` avalia registros fornecidos pelo chamador (não varre o banco) — falsa sensação de cobertura. | tenantIsolationAuditService | `tenantIsolationAuditService` varre o banco (ou é renomeado como verificador de amostra) | Não | PLAN |
| SEM-089 | `dfdj:${key}`.slice(0,64) pode colidir chaves longas. | dfdj:${key} | Chave `dfdj:` por hash completo (sem truncar) | Não | PLAN |
| SEM-090 | Quantidade nula gravada como 0 na promoção (0 entra na chave lógica). |  | Quantidade nula ≠ 0 na promoção (fora da chave lógica) | Não | PLAN |
| SEM-091 | Credenciamento inexistente como regime; prompt de parecer legado lê `legalArticle` inexistente. | legalArticle | Credenciamento como regime (se o órgão usar) e prompt do parecer legado sem `legalArticle` inexistente | Não | BLOCKED_LEGAL_REVIEW (J-5) |
| SEM-092 | Componente `WorkspaceDecisionPanel` com decisões fictícias ("Ana Souza", "Carlos Lima") como default — sem consumidor hoje (risco se reutilizado). | WorkspaceDecisionPanel | `WorkspaceDecisionPanel` sem defaults fictícios (ou removido) | Não | PLAN |

## LEG-007 (UI morta) e LEG-031 (redirects)

- **LEG-007**: componentes de UI sem rota/consumidor (ex.: `WorkspaceDecisionPanel`, SEM-092) — remover ou isolar; não
  removidos nesta branch (decisão de produto sobre reaproveitamento). Inventário: `docs/audits/R2_LEGACY_REACHABILITY_INVENTORY.md`.
- **LEG-031**: os redirects de rotas legadas para as canônicas **permanecem** (não removidos), conforme o plano.
