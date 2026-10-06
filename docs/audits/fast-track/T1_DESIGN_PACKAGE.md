# T1 DESIGN PACKAGE — contratos de domínio puros (DESENHO; sem implementação)

Convenções: TypeScript strict; funções puras; sem I/O; hashes sha256 hex versionados; `organizationId` sempre explícito.

```ts
type OrgId = number;                       // organizations.id INT
type Sha256 = string;                      // 64 hex
type HashVersion = "tpl-hash/1";

// ── Identidade e revisão ─────────────────────────────────────────────
interface TemplateIdentity {               // imutável após criação
  id: string;                              // varchar(24), unicode_ci
  organizationId: OrgId;                   // obrigatório; sem PLATFORM_GLOBAL
  documentKind: "dfd" | "etp" | "tr" | "edital" | "parecer" | "contrato" | "aditivo";
  slug: string;
  createdAt: string; createdByUserId: number;
}
type RevisionStatus = "DRAFT" | "APPROVED" | "PUBLISHED" | "RETIRED";   // APPROVED != PUBLISHED
interface TemplateRevision {               // append-only; PUBLISHED imutável
  id: string; identityId: string; organizationId: OrgId;
  revision: number;                        // UNIQUE(org, identity, revision)
  status: RevisionStatus;
  ast: TemplateAST;
  variableCatalogVersion: string;
  semanticHash: Sha256; hashVersion: HashVersion;   // hash do AST canônico + catálogo
  sourceFormat: "NATIVE" | "MARKDOWN_IMPORT" | "DOCX_IMPORT";    // import nunca vai direto a PUBLISHED
  approvalDecisionId?: string; publishDecisionId?: string;       // institutional_decisions
}
interface TemplateBinding {                // determinístico; sem IA
  id: string; organizationId: OrgId;
  documentKind: TemplateIdentity["documentKind"];
  scope: { modality?: string; regime?: string; criterion?: string };   // igualdade exata
  identityId: string; pinnedRevisionId?: string;                        // ausente = última PUBLISHED
  active: boolean; effectiveFrom: string;
}

// ── AST (whitelist) ──────────────────────────────────────────────────
type TemplateAST = { schema: "tpl-ast/1"; root: Node[] };
type Node =
  | { t: "heading"; level: 1|2|3|4; text: TextExpr }
  | { t: "paragraph"; inline: Inline[] }
  | { t: "list"; ordered: boolean; items: Node[][] }
  | { t: "table"; header: TextExpr[]; rows: TextExpr[][] }
  | { t: "section"; key: string; legalRef?: string; children: Node[] }
  | { t: "conditional"; when: Cond; then: Node[]; else?: Node[] }
  | { t: "docRef"; kind: "TR" | "ETP" | "DFD" | "ANNEX"; mode: "EXACT_PINNED" }
  | { t: "annex"; id: string; title: TextExpr; children: Node[] }
  | { t: "aiSlot"; slotKey: string; maxTokens: number; instructionsKey: string };   // ÚNICO ponto de IA
type Inline = { t: "text"; v: string } | { t: "var"; name: string } | { t: "strong"|"em"; v: Inline[] };
type TextExpr = Inline[];

// ── Catálogo de variáveis (versionado) ───────────────────────────────
interface VariableDef { name: string; type: "string"|"number"|"money"|"date"|"enum"|"list";
  source: "PROCESS"|"DFD"|"ETP"|"TR"|"ITEMS"|"PARAMS"|"IDENTITY"; path: string; required: boolean; }
interface VariableCatalog { version: string; vars: readonly VariableDef[]; }   // variável desconhecida ⇒ submit bloqueado

// ── DSL condicional (fechada, sem eval) ──────────────────────────────
type Cond =
  | { op: "eq"|"ne"; var: string; value: string|number|boolean }
  | { op: "in"; var: string; values: (string|number)[] }
  | { op: "present"|"absent"; var: string }
  | { op: "and"|"or"; of: Cond[] } | { op: "not"; of: Cond };
// Sem expressões livres, sem funções, sem regex, profundidade ≤ 4; avaliação pura e determinística.

// ── Manifest de composição (insert-only) ─────────────────────────────
interface CompositionManifest {
  id: string; organizationId: OrgId; generatedDocumentId: string;
  templateRevisionId: string; templateSemanticHash: Sha256; hashVersion: HashVersion;
  catalogVersion: string;
  sources: { key: "processo"|"dfd"|"etp"|"tr"|"itens"|"parametros"; digest: string /* srcd: */ }[];
  officialDocRefs: { documentId: string; lineageId: string; version: number; contentHash: Sha256 }[];  // EXACT_PINNED
  aiNarratives: { slotKey: string; executionId: string; outputHash: Sha256; humanAccepted: boolean }[];
  annexes: { id: string; contentHash: Sha256 }[];
  identityFingerprint: string;            // = official_document_artifacts.identity_fingerprint
  composedContentHash: Sha256;            // hash do conteúdo persistido
  manifestHash: Sha256;                   // hash canônico do próprio manifest
  createdAt: string;
}

// ── Composer puro ────────────────────────────────────────────────────
declare function compose(input: {
  revision: TemplateRevision; catalog: VariableCatalog;
  values: Readonly<Record<string, unknown>>;              // já resolvidos por quem chama
  aiNarratives: Readonly<Record<string, string>>;         // já obtidas ANTES da transação
}): { content: ComposedContent; manifestDraft: Omit<CompositionManifest, "id"|"createdAt"> }
  | { error: "UNKNOWN_VARIABLE"|"MISSING_REQUIRED"|"AST_INVALID"|"CONDITION_INVALID" };
```

## Definições de hash semântico (versionadas)
- `semanticHash = sha256(canonicalJSON({ hashVersion, ast, variableCatalogVersion }))`; JSON canônico: chaves ordenadas, sem espaços, números normalizados, strings NFC. Qualquer mudança de regra incrementa `hashVersion` (nunca reinterpreta hashes antigos).
- `manifestHash = sha256(canonicalJSON(manifest sem id/createdAt/manifestHash))`.
- `replay_hash` v2 do documento oficial = f(replay_hash v1, manifestHash).

## Invariantes executáveis (testes de propriedade a escrever na fase T1)
composer determinístico (mesma entrada ⇒ mesma saída/hash); nenhuma variável fora do catálogo; condicional sem efeitos; AST fora da whitelist rejeitado; revisão PUBLISHED imutável; revisão referenciada por manifest não removível; tenant: toda leitura/escrita por `organizationId`; erro de composição com flag ON ⇒ falha fechada (sem fallback silencioso).

## Validação com o Modelo-Mestre 1.0.1-draft (somente contrato, sem importar)
placeholders → `var`; condicionais → `conditional`+`Cond`; referência ao TR → `docRef{kind:"TR",EXACT_PINNED}`; Anexo I → `annex`; edição humana → conteúdo composto persistido + marcador SEM-044; revalidação canônica → recomposição de verificação contra `manifest` antes da emissão (sem mutar em `SOURCE_CHANGED`).
