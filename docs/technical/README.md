# LiciGov Pro — Documentação Técnica

> Documentação técnica do sistema: APIs, schemas, serviços e infraestrutura.
> Atualizado em: 2026-05-27

---

## Visão Geral

Este diretório contém a documentação técnica detalhada de todos os módulos do LiciGov Pro. Cada seção documenta APIs, contratos de dados, comportamentos esperados e pontos de extensão.

---

## tRPC API — Routers Disponíveis

### organizations
```typescript
organizations.create           // Criar nova organização
organizations.get              // Buscar organização por ID
organizations.update           // Atualizar dados da organização
organizations.members.list     // Listar membros
organizations.members.invite   // Convidar membro
organizations.members.remove   // Remover membro
organizations.members.changeRole // Alterar papel de membro
```

### documents
```typescript
documents.create               // Criar documento (inicia como draft)
documents.get                  // Buscar documento + versão atual
documents.list                 // Listar documentos da organização
documents.update               // Atualizar conteúdo (cria nova versão)
documents.submitForReview      // Submeter para revisão
documents.approve              // Aprovar documento
documents.reject               // Rejeitar com comentário
documents.archive              // Arquivar documento aprovado
documents.restore              // Restaurar versão anterior
documents.lock                 // Aplicar lock de edição
documents.unlock               // Remover lock
documents.export               // Exportar em HTML/DOCX/PDF
documents.versions.list        // Listar versões
documents.versions.diff        // Diff semântico entre versões
documents.comments.add         // Adicionar comentário
documents.comments.reply       // Responder em thread
documents.comments.list        // Listar comentários
documents.integrity.verify     // Verificar integridade SHA-256
```

### imports
```typescript
imports.session.start          // Iniciar sessão de importação
imports.session.get            // Status da sessão
imports.session.list           // Listar sessões da organização
imports.session.cancel         // Cancelar sessão
imports.staging.list           // Listar itens em staging
imports.staging.review         // Revisar item (approve/reject/modify)
imports.staging.approveAll     // Aprovar todos os itens com confiança ≥ threshold
imports.staging.promote        // Promover staging aprovado ao domínio
```

---

## Schemas de Dados Principais

### DocumentoLicitatorio
```typescript
interface DocumentoLicitatorio {
  id: string;                  // UUID
  organizationId: string;      // Multi-tenant key
  type: 'tr' | 'etp' | 'edital' | 'contrato';
  title: string;
  status: DocumentWorkflowStatus;
  currentVersionId: string;
  lockType: 'none' | 'soft' | 'hard';
  lockOwnerId: string | null;
  retentionClass: RetentionClass;
  integrityHash: string;       // SHA-256 da versão atual
  createdAt: Date;
  updatedAt: Date;
  version: number;             // Optimistic locking
}

type DocumentWorkflowStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'archived';

type RetentionClass =
  | 'legal_permanent'
  | 'legal_7years'
  | 'operational_3years'
  | 'draft_7days'
  | 'log_2years'
  | 'temp_30days'
  | 'attachment_follows_document';
```

### ImportSession
```typescript
interface ImportSession {
  id: string;
  organizationId: string;
  importType: 'price_research' | 'tr_items' | 'catmat' | 'generic';
  status: ImportSessionStatus;
  filePath: string;
  parserMime: string;
  totalRows: number | null;
  processedRows: number;
  confidenceSummary: ConfidenceSummary;
  createdAt: Date;
  completedAt: Date | null;
}

type ImportSessionStatus =
  | 'uploaded' | 'queued' | 'parsing' | 'extracted'
  | 'normalized' | 'awaiting_review' | 'approved'
  | 'rejected' | 'failed' | 'archived';

interface ConfidenceSummary {
  high: number;    // count de itens com score ≥ 0.85
  medium: number;  // count de itens com score ≥ 0.60
  low: number;     // count de itens com score ≥ 0.35
  uncertain: number; // count de itens com score < 0.35
}
```

---

## Serviços Técnicos

### PolicyEngine
Avalia permissões por ação, papel RBAC e estado do documento.
```typescript
policyEngine.can(action: DocumentAction, userId: string, document: DocumentoLicitatorio): PolicyResult
```

### DiffEngine
Compara duas versões de documento semanticamente.
```typescript
diffEngine.diff(versionA: DocumentVersion, versionB: DocumentVersion): SemanticDiff
diffEngine.blockDiff(a, b): BlockDiff[]
diffEngine.sectionDiff(a, b): SectionDiff[]
diffEngine.variableDiff(a, b): VariableDiff[]
```

### IntegrityService
```typescript
integrityService.computeHash(content: DocumentContent): string       // SHA-256
integrityService.verifyChain(versions: DocumentVersion[]): boolean   // verifica cadeia
integrityService.snapshotFingerprint(snapshot: object): string
```

### ConcurrencyService
```typescript
concurrencyService.acquireSoftLock(documentId, userId): LockResult
concurrencyService.acquireHardLock(documentId, userId): LockResult
concurrencyService.releaseLock(documentId, userId): void
concurrencyService.checkLock(documentId): LockStatus
```

### RenderService
```typescript
renderService.toHtml(document: DocumentoLicitatorio, version: DocumentVersion): string
renderService.toDocx(document, version): Buffer
renderService.toPdf(document, version): Buffer
```

---

## Configuração do Ambiente

### Variáveis de Ambiente Obrigatórias
```env
DATABASE_URL=mysql://user:pass@host:3306/licigov_pro
JWT_SECRET=<32-byte random>
NODE_ENV=production|development|test
PORT=3000
```

### Variáveis Opcionais
```env
RAILWAY_ENVIRONMENT=production
LOG_LEVEL=info|debug|warn|error
IMPORT_QUEUE_CONCURRENCY=3
MAX_FILE_SIZE_MB=50
```

---

## Migrações de Banco de Dados

Todas as migrações ficam em `/drizzle/migrations/`. Para executar:

```bash
pnpm drizzle-kit migrate      # Aplica migrações pendentes
pnpm drizzle-kit generate     # Gera nova migração a partir do schema
pnpm drizzle-kit studio       # Interface visual do banco
```

### Última migração aplicada: 0055
Ver histórico completo em: [architecture/database/](../../architecture/database/)

---

*Para arquitetura do sistema: [architecture/SYSTEM_ARCHITECTURE.md](../../architecture/SYSTEM_ARCHITECTURE.md)*
