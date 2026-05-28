# LiciGov Pro — Visão do Domínio

> Modelo de domínio do LiciGov Pro: aggregates, entidades, value objects e eventos.
> Versão: 2.8 | Atualizado em: 2026-05-27

---

## Bounded Contexts

O domínio do LiciGov Pro é dividido em contextos delimitados:

```
┌─────────────────────┐  ┌─────────────────────┐
│   Identity &        │  │   Document          │
│   Organization      │  │   Management        │
│                     │  │                     │
│  Organization       │  │  DocumentoLicitatorio│
│  OrganizationMember │  │  DocumentVersion    │
│  ActivityLog        │  │  DocumentTemplate   │
│  OutboxEvent        │  │  DocumentComment    │
└─────────────────────┘  └─────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│   Import &          │  │   Catalog           │
│   Staging           │  │   (Sprint 3)        │
│                     │  │                     │
│  ImportSession      │  │  CatmatItem         │
│  ImportStaging      │  │  CatserItem         │
│  ParserRegistry     │  │  PriceReference     │
└─────────────────────┘  └─────────────────────┘
```

---

## Aggregates

### 1. Organization (Raiz do Multi-tenant)

**Responsabilidades**:
- Representa uma entidade pública ou empresa que usa a plataforma
- Gerencia membros e seus papéis
- Define configurações da organização

**Invariantes**:
- Deve ter exatamente um `owner` ativo
- Owner não pode ser removido sem transferência de ownership
- CNPJ é único no sistema
- `organizationId` é imutável após criação

**Entidades filhas**:
- `OrganizationMember` — usuário com papel na organização

**Eventos de domínio**:
- `OrganizationCreated`
- `MemberInvited`
- `MemberRoleChanged`
- `MemberRemoved`
- `OwnershipTransferred`

---

### 2. DocumentoLicitatorio (Core)

**Responsabilidades**:
- Gerencia o ciclo de vida de documentos licitatórios
- Controla versionamento imutável de conteúdo
- Coordena workflow de aprovação
- Mantém integridade via SHA-256

**Invariantes**:
- Pertence a exatamente uma organização (`organizationId` imutável)
- Tipo de documento (`tr`, `etp`, `edital`, `contrato`) é imutável após criação
- Versões aprovadas são imutáveis (nenhuma edição retroativa)
- Hash de integridade deve ser consistente com o conteúdo
- Apenas um hard lock pode existir por documento

**Entidades filhas**:
- `DocumentVersion` — versão imutável do conteúdo
- `DocumentComment` — comentário com threading
- `DocumentAttachment` — arquivo anexado
- `DocumentTimelineEntry` — evento da timeline

**Value Objects**:
- `DocumentWorkflowStatus` — estado atual no workflow
- `RetentionClass` — política de retenção
- `DocumentLock` — estado do lock (tipo + owner)
- `IntegrityHash` — SHA-256 da versão atual

**Eventos de domínio**:
- `DocumentCreated`
- `DocumentVersionSaved`
- `DocumentSubmittedForReview`
- `DocumentApproved`
- `DocumentRejected`
- `DocumentArchived`
- `DocumentLockAcquired`
- `DocumentLockReleased`

---

### 3. ImportSession (Import Bounded Context)

**Responsabilidades**:
- Gerencia o ciclo de vida de uma importação de dados externos
- Coordena parsing, normalização e staging
- Garante rastreabilidade de proveniência

**Invariantes**:
- Pertence a exatamente uma organização
- Status só avança; nunca retrocede (exceto `failed` → `archived`)
- Dados de staging NUNCA são promovidos ao domínio sem aprovação humana
- Proveniência deve ser registrada para cada item extraído

**Entidades filhas**:
- `ImportStagingItem` — item extraído e normalizado

**Value Objects**:
- `ImportSessionStatus` — status atual
- `ImportType` — tipo de importação
- `ConfidenceSummary` — resumo dos scores de confiança
- `ExtractionProvenance` — origem do dado (arquivo, linha, coluna, página)
- `ConfidenceLevel` — high/medium/low/uncertain

**Eventos de domínio**:
- `ImportSessionStarted`
- `ImportFileParsed`
- `ImportNormalizationCompleted`
- `ImportAwaitingReview`
- `ImportApproved`
- `ImportRejected`
- `ImportFailed`

---

### 4. ActivityLog (Auditoria)

**Responsabilidades**:
- Registra todas as ações realizadas no sistema
- Preserva estado before/after de mutações
- Imutável por design

**Invariantes**:
- NUNCA atualizado ou deletado
- Sempre inclui `organizationId`, `userId`, `timestamp`
- Snapshots before/after para todas as mutações
- TTL de 2 anos (LGPD compliance)

---

## Modelo de Domínio — Relacionamentos

```
Organization (1)
  │
  ├── OrganizationMember (N) ← User
  │
  ├── DocumentoLicitatorio (N)
  │     ├── DocumentVersion (N)       [imutável]
  │     ├── DocumentComment (N)
  │     │     └── CommentReply (N)
  │     ├── DocumentAttachment (N)
  │     └── DocumentTimelineEntry (N) [imutável]
  │
  ├── DocumentTemplate (N)
  │
  ├── ImportSession (N)
  │     └── ImportStagingItem (N)
  │
  ├── ActivityLog (N)  [imutável, append-only]
  │
  └── OutboxEvent (N)  [processado assincronamente]
```

---

## Value Objects Principais

### DocumentWorkflowStatus
```typescript
type DocumentWorkflowStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'archived';
```
Transições válidas — ver [docs/workflows/README.md](../docs/workflows/README.md)

### RetentionClass
```typescript
type RetentionClass =
  | 'legal_permanent'      // Editais
  | 'legal_7years'         // Contratos, TRs, ETPs aprovados
  | 'operational_3years'   // Documentos operacionais
  | 'draft_7days'          // Rascunhos não promovidos
  | 'log_2years'           // Activity logs
  | 'temp_30days'          // Temporários de importação
  | 'attachment_follows_document'; // Anexos
```

### OrganizationRole
```typescript
type OrganizationRole = 'viewer' | 'operator' | 'manager' | 'admin' | 'owner';
// Hierárquico: owner > admin > manager > operator > viewer
```

### ConfidenceLevel
```typescript
type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';
// high: ≥ 0.85 | medium: ≥ 0.60 | low: ≥ 0.35 | uncertain: < 0.35
```

---

## Linguagem Ubíqua (Ubiquitous Language)

| Termo no Código | Significado no Domínio |
|---|---|
| `DocumentoLicitatorio` | Qualquer documento formal do processo licitatório |
| `submitForReview` | Submeter para aprovação formal |
| `approve` | Aprovar com força legal |
| `reject` | Rejeitar com exigência de correção |
| `archive` | Arquivar no histórico permanente |
| `staging` | Área de quarentena para dados importados |
| `promote` | Promover dados do staging ao domínio |
| `provenance` | Rastreabilidade de origem de cada dado |
| `fingerprint` | Hash encadeado que prova integridade da cadeia |
| `retentionClass` | Classificação que determina por quanto tempo o dado é mantido |
| `hardLock` | Bloqueio exclusivo que impede edição por outros |
| `softLock` | Aviso visual de que outro usuário está editando |

---

*Para arquitetura do sistema: [architecture/SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)*
*Para motor documental: [architecture/DOCUMENT_ENGINE.md](./DOCUMENT_ENGINE.md)*
