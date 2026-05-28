# LiciGov Pro — Modelo Multi-tenant

> Documentação do modelo multi-tenant: isolamento, RBAC e segurança.
> Versão: 2.8 | Atualizado em: 2026-05-27

---

## Princípio Fundamental

O LiciGov Pro é **multi-tenant por design**, não por configuração. Cada organização tem isolamento completo de dados, sem qualquer compartilhamento entre tenants.

**Regra absoluta**: `organizationId` é obrigatório em TODOS os aggregates, queries e operações. Não existe exceção.

---

## Modelo de Tenant

### Organization como Tenant Root
```
tenant = Organization

Organization
  ├── tem N membros (OrganizationMember)
  ├── tem N documentos (DocumentoLicitatorio)
  ├── tem N importações (ImportSession)
  └── tem N logs (ActivityLog)
```

### Hierarquia de Acesso
```
User (global, pode pertencer a múltiplas orgs)
  └── OrganizationMember (local a uma org)
        └── role: viewer | operator | manager | admin | owner
```

Um mesmo usuário pode ter papéis diferentes em organizações diferentes.

---

## Isolamento por Camada

### Camada 1: Autenticação (JWT)
```typescript
// JWT Claims obrigatórios
interface JWTClaims {
  sub: string;           // userId (global)
  orgId: string;         // organizationId do contexto atual
  role: OrganizationRole; // papel nesta organização
  iat: number;
  exp: number;
}
```
- `orgId` é extraído do token, não do corpo da requisição
- Usuário seleciona organização ativa no login
- Token muda ao trocar de organização (novo par orgId/role)

### Camada 2: tRPC Context
```typescript
// Context injetado em cada procedure autenticada
interface AuthenticatedContext {
  userId: string;
  organizationId: string;    // NUNCA opcional
  role: OrganizationRole;
  requestId: string;
  correlationId: string;
}
```
- Context é construído a partir do JWT validado
- Nenhuma procedure recebe `organizationId` como input — sempre do context

### Camada 3: Application Layer
```typescript
// Use cases recebem organizationId do context
async function createDocument(
  command: CreateDocumentCommand,
  ctx: AuthenticatedContext
): Promise<DocumentoLicitatorio> {
  // PolicyEngine valida com organizationId do context
  const canCreate = policyEngine.can('create', ctx.userId, ctx.organizationId);

  // Repository chamado com organizationId do context
  return documentRepo.create({
    ...command,
    organizationId: ctx.organizationId, // SEMPRE do context
  });
}
```

### Camada 4: Repository (Drizzle)
```typescript
// TODA query inclui organizationId
async findById(id: string, organizationId: string) {
  return db.query.documentosLicitatorios.findFirst({
    where: and(
      eq(documentosLicitatorios.id, id),
      eq(documentosLicitatorios.organizationId, organizationId) // OBRIGATÓRIO
    ),
  });
}

// Retorna null em vez de lançar erro (não vaza existência de recursos)
// Se documento existe em outra org, retorna null silenciosamente
```

### Camada 5: Database
```sql
-- Índices compostos com organization_id como prefixo
CREATE INDEX org_status_idx ON documentos_licitatorios (organization_id, status);
CREATE INDEX org_created_idx ON activity_logs (organization_id, created_at DESC);
CREATE INDEX org_type_idx ON import_sessions (organization_id, import_type);
```

---

## RBAC — Role-Based Access Control

### Papéis Hierárquicos

```
owner (5)  — Controle total
  └── admin (4)  — Aprovação e gestão
        └── manager (3)  — Submissão para revisão
              └── operator (2)  — Criação e edição
                    └── viewer (1)  — Leitura apenas
```

### Avaliação de Permissões

O `PolicyEngine` recebe: ação, usuário, documento (ou recurso):
```typescript
const result = policyEngine.can('approve', userId, document);
// result: { allowed: boolean, reason?: string }
```

Critérios de avaliação:
1. **Papel do usuário** ≥ papel mínimo para a ação
2. **Estado do documento** permite a ação (ex: só aprova se `in_review`)
3. **Propriedade** (ex: operator só deleta seus próprios drafts)
4. **Lock status** (hard lock bloqueia edição por outros)
5. **Separação de funções** (ex: quem submeteu não pode aprovar)

### 14 Ações Controladas pelo PolicyEngine

| Ação | Papel Mínimo | Estado Requerido |
|---|---|---|
| `edit` | operator | draft, rejected |
| `submit_review` | manager | draft |
| `approve` | admin | in_review |
| `reject` | admin | in_review |
| `restore_version` | admin | qualquer |
| `comment` | operator | qualquer |
| `archive` | admin | approved |
| `unlock` (others) | admin | qualquer |
| `export` | operator | aprovado/arquivado |
| `delete_draft` | operator (own) | draft |
| `manage_attachments` | operator | draft |
| `view_history` | viewer | qualquer |
| `manage_lock` | admin | qualquer |
| `verify_integrity` | admin | qualquer |
| `purge` | owner | archived + retenção expirada |

---

## Gerenciamento de Membros

### Ciclo de Vida de Membro
```
Convite enviado (owner ou admin)
  → Email enviado ao usuário
  → Usuário aceita (link com token temporário)
  → Membro criado com papel atribuído
  → Membro pode trocar de papel (admin+ muda papéis de outros)
  → Membro pode ser removido (owner pode remover qualquer um)
```

### Regras de Membership
- Um usuário pode ser membro de múltiplas organizações
- Não existe "super-admin" global — todo acesso é por organização
- Owner não pode remover a si mesmo sem transferir ownership
- Transferência de ownership requer confirmação explícita
- Membros removidos perdem acesso imediatamente (JWT invalidado no próximo request)

---

## Isolamento de Dados — Exemplos Práticos

### Cross-tenant Access (deve ser IMPOSSÍVEL)
```typescript
// ❌ NUNCA deve ser possível
const orgADocument = await findDocument(docId, 'ORG_B_ID');
// → Retorna null (não expõe existência do recurso)

// ✅ O que acontece internamente
// Repository WHERE: id = docId AND organization_id = 'ORG_B_ID'
// → Retorna 0 rows → null
```

### Logging de Violação de Tenant
```typescript
// Se organizationId do token ≠ organizationId da requisição
// → Log de segurança com nível CRITICAL
// → Incrementa contador de métricas (tentativas de cross-tenant)
// → Bloqueia o request (não retorna dados do outro tenant)
```

---

## Idempotência Multi-tenant

Chave de idempotência inclui `organizationId`:
```
idempotency_key = SHA-256(`${organizationId}:${operationType}:${clientKey}`)
```

Garante que operações duplicadas de um tenant não afetam outros.

---

*Para segurança: [docs/security/README.md](../docs/security/README.md)*
*Para arquitetura: [architecture/SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)*
