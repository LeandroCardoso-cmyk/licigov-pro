# LiciGov Pro — Workflows Documentais

> Documentação dos workflows de documentos: state machine, transições, locks e eventos.
> Atualizado em: 2026-05-27

---

## State Machine de Documentos

### Estados Possíveis

| Estado | Descrição | Editável? | Exportável? |
|---|---|---|---|
| `draft` | Rascunho em elaboração | ✅ | ❌ |
| `in_review` | Em processo de revisão | ❌ (lock) | ✅ (read-only) |
| `approved` | Aprovado e validado | ❌ | ✅ |
| `rejected` | Rejeitado, aguardando correção | ✅ (volta a draft) | ❌ |
| `archived` | Arquivado (histórico) | ❌ | ✅ |

### Diagrama de Transições

```
                     ┌──────────────────────┐
                     │                      │
             ┌───────▼──────┐               │
    ──────►  │    DRAFT     │               │
             └───────┬──────┘               │
                     │ submit_review         │ (rejected → draft
                     │ (manager+)            │  é automático)
             ┌───────▼──────┐               │
             │  IN_REVIEW   │               │
             └──────┬───────┘               │
           ┌────────┴──────────┐            │
    approve│                   │reject      │
    (admin+)                   │(admin+)    │
           │                   │            │
     ┌─────▼──────┐    ┌───────▼───────┐   │
     │  APPROVED  │    │   REJECTED    ├───┘
     └─────┬──────┘    └───────────────┘
           │ archive
           │ (admin+)
     ┌─────▼──────┐
     │  ARCHIVED  │
     └────────────┘
```

---

## Transições Detalhadas

### draft → in_review (`submitForReview`)
- **Papel mínimo**: `manager`
- **Pré-condições**:
  - Documento tem título não vazio
  - Conteúdo não está vazio
  - Não há hard lock por outro usuário
- **Efeitos**:
  - Status muda para `in_review`
  - Soft lock automático (não impede leitura)
  - Notificação enviada para admins da organização
  - Entrada na timeline do documento

### in_review → approved (`approve`)
- **Papel mínimo**: `admin`
- **Pré-condições**:
  - Todos os comentários de bloqueio foram resolvidos
  - Usuário não é o mesmo que submeteu para revisão (separação de funções)
- **Efeitos**:
  - Status muda para `approved`
  - Hash SHA-256 da versão atual registrado
  - `snapshotFingerprint` calculado e armazenado
  - Lock removido
  - Entrada na timeline

### in_review → rejected (`reject`)
- **Papel mínimo**: `admin`
- **Parâmetros obrigatórios**: comentário de rejeição (min 20 caracteres)
- **Efeitos**:
  - Status muda para `rejected`
  - Comentário de rejeição visível ao criador
  - Notificação enviada ao operador responsável
  - Lock removido

### rejected → draft (automático ou manual)
- **Papel mínimo**: `operator` (próprio documento) ou `manager`
- **Efeitos**:
  - Status volta a `draft`
  - Histórico de rejeição preservado na timeline
  - Nova versão criada ao primeiro save

### approved → archived (`archive`)
- **Papel mínimo**: `admin`
- **Pré-condições**:
  - Documento está em `approved`
- **Efeitos**:
  - Status muda para `archived`
  - Documento preservado com integridade verificável
  - Contador de retenção inicia (ex: 7 anos para contratos)

---

## Sistema de Locks

### Soft Lock
- **Natureza**: Aviso visual, não bloqueia
- **Quando aplicado**: Usuário abre documento para edição
- **Visível para**: Todos os membros que visualizam o documento
- **Expiração**: 60 minutos de inatividade
- **Liberação**: Manual ou automática

### Hard Lock
- **Natureza**: Bloqueio real — impede edição por outros
- **Quando aplicado**: Explicitamente por `admin+` ou durante `in_review`
- **Quem pode remover**: O próprio owner do lock ou `admin+`
- **Expiração**: 4 horas (segurança contra locks orphaned)
- **Liberação**: Manual (preferido) ou automática por timeout

### Regras de Lock
1. Apenas um hard lock por documento ao mesmo tempo
2. Múltiplos soft locks são permitidos
3. Hard lock durante `in_review` é automático (proteção contra edição paralela)
4. Owner pode forçar release de lock (com log de auditoria)

---

## Timeline de Documentos

Cada documento tem uma timeline imutável de eventos:

```typescript
interface TimelineEntry {
  id: string;
  documentId: string;
  organizationId: string;
  type: TimelineEventType;
  userId: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  versionId?: string;           // Versão relacionada, se aplicável
}

type TimelineEventType =
  | 'created'
  | 'version_saved'
  | 'submitted_for_review'
  | 'approved'
  | 'rejected'
  | 'archived'
  | 'lock_acquired'
  | 'lock_released'
  | 'comment_added'
  | 'version_restored'
  | 'integrity_verified'
  | 'exported';
```

---

## Versionamento de Conteúdo

### Versão Semântica Interna
Cada `DocumentVersion` tem um número sequencial interno:
- `v1` — criação inicial
- `v2`, `v3`, etc. — cada save cria nova versão
- Versões não são excluídas (imutabilidade)

### DiffEngine — Tipos de Diff

#### Block Diff
Identifica blocos de conteúdo adicionados, removidos ou modificados:
```typescript
interface BlockDiff {
  type: 'added' | 'removed' | 'modified';
  blockId: string;
  content?: string;
  previousContent?: string;
}
```

#### Section Diff
Compara seções nomeadas (ex: "Objeto", "Especificações"):
```typescript
interface SectionDiff {
  sectionName: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  changePercent: number;    // 0-100% de mudança
}
```

#### Variable Diff
Rastreia mudanças em variáveis interpoladas (ex: `{{valor_total}}`):
```typescript
interface VariableDiff {
  variableName: string;
  previousValue: string | null;
  newValue: string | null;
}
```

---

## Eventos de Domínio

Os seguintes eventos são emitidos via Outbox para cada transição:

| Evento | Gatilho | Consumidores |
|---|---|---|
| `document.draft_created` | Criação | NotificationService |
| `document.submitted_for_review` | submitForReview | NotificationService |
| `document.approved` | approve | NotificationService, IntegrityService |
| `document.rejected` | reject | NotificationService |
| `document.archived` | archive | RetentionService |
| `document.version_created` | save | IntegrityService |
| `document.lock_acquired` | lock | — |
| `document.lock_released` | unlock | — |

---

*Para segurança e RBAC: [docs/security/README.md](../security/README.md)*
*Para motor documental completo: [architecture/DOCUMENT_ENGINE.md](../../architecture/DOCUMENT_ENGINE.md)*
