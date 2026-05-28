# LiciGov Pro — Segurança e RBAC

> Documentação de segurança: multi-tenant, RBAC, autenticação e proteção de dados.
> Atualizado em: 2026-05-27

---

## Modelo Multi-tenant

### Princípio de Isolamento
O LiciGov Pro é **multi-tenant por design**, não por configuração. Isso significa:

1. **`organizationId` é obrigatório em TODOS os aggregates**
2. **Toda query ao banco filtra por `organizationId`**
3. **Violação de tenant é tratada como erro de segurança**

### Camadas de Isolamento

```
Camada 1: JWT Claims
  → organizationId extraído do token JWT em cada request
  → Validado contra membro ativo da organização

Camada 2: Application Layer
  → tRPC context injeta organizationId validado
  → Nenhuma procedure aceita organizationId do body/query

Camada 3: Repository Layer
  → Toda query Drizzle inclui WHERE organization_id = ?
  → Sem exceção: nem endpoints "admin" pulam essa validação

Camada 4: Database
  → Foreign keys referenciam organizations
  → Índices compostos com organization_id como prefixo
```

---

## RBAC — Role-Based Access Control

### Papéis Hierárquicos

```
owner (5)
  └── admin (4)
        └── manager (3)
              └── operator (2)
                    └── viewer (1)
```

Papéis são cumulativos: um `manager` pode fazer tudo que `operator` e `viewer` podem.

### Matriz de Permissões por Documento

| Ação | viewer | operator | manager | admin | owner |
|---|:---:|:---:|:---:|:---:|:---:|
| view_document | ✅ | ✅ | ✅ | ✅ | ✅ |
| view_history | ✅ | ✅ | ✅ | ✅ | ✅ |
| edit | ❌ | ✅ (draft/rejected) | ✅ | ✅ | ✅ |
| comment | ❌ | ✅ | ✅ | ✅ | ✅ |
| submit_review | ❌ | ❌ | ✅ | ✅ | ✅ |
| approve | ❌ | ❌ | ❌ | ✅ | ✅ |
| reject | ❌ | ❌ | ❌ | ✅ | ✅ |
| archive | ❌ | ❌ | ❌ | ✅ | ✅ |
| restore_version | ❌ | ❌ | ❌ | ✅ | ✅ |
| export | ❌ | ✅ | ✅ | ✅ | ✅ |
| manage_lock | ❌ | ❌ | ❌ | ✅ | ✅ |
| manage_attachments | ❌ | ✅ | ✅ | ✅ | ✅ |
| verify_integrity | ❌ | ❌ | ❌ | ✅ | ✅ |
| delete_draft | ❌ | ✅ (own) | ✅ | ✅ | ✅ |
| purge | ❌ | ❌ | ❌ | ❌ | ✅ |
| unlock (outros) | ❌ | ❌ | ❌ | ✅ | ✅ |

### Avaliação de Permissões — PolicyEngine

O `PolicyEngine` avalia permissões considerando:
1. **Papel do usuário** na organização
2. **Estado atual** do documento (workflow status)
3. **Propriedade** (ex: operator pode deletar apenas seus próprios drafts)
4. **Lock status** (hard lock bloqueia edição por outros)

```typescript
// Exemplo de uso
const result = policyEngine.can('approve', userId, document);
// result: { allowed: boolean, reason?: string }
```

---

## Autenticação

### JWT (JSON Web Tokens)
- Tokens gerados com `JWT_SECRET` de 32+ bytes
- Expiração: 24h para sessões normais, 7d para "remember me"
- Claims obrigatórios: `sub` (userId), `orgId` (organizationId), `role`, `iat`, `exp`
- Refresh token com rotação (invalidação do token anterior)

### Validação em Cada Request
```
1. Extrai Bearer token do header Authorization
2. Verifica assinatura JWT
3. Verifica expiração
4. Valida organizationId do claim contra membership ativo no banco
5. Injeta no tRPC context: { userId, organizationId, role }
```

---

## Proteção de Dados (LGPD)

### Princípio de Minimização
- Apenas dados necessários ao processo licitatório são coletados
- Dados pessoais de membros: nome, email, CPF (opcional)
- Nenhum dado sensível nos logs de auditoria (apenas IDs)

### Retenção e Purge
| Dado | Retenção | Purge Automático |
|---|---|---|
| Documentos (contratos) | 7 anos | Após aprovação do gestor |
| Rascunhos não promovidos | 7 dias | Automático |
| Logs de auditoria | 2 anos | Automático com TTL index |
| Dados de sessão | 7 dias | Automático |
| Arquivos importados (staging) | 30 dias | Automático |

---

## Integridade de Documentos

### SHA-256 por Versão
Cada versão de documento tem um hash SHA-256 calculado sobre:
- Conteúdo JSON serializado (ordenação determinística)
- Metadados imutáveis (author, timestamp, version_number)

### Cadeia de Fingerprints
O `snapshotFingerprint` encadeia os hashes de versões consecutivas:
```
fingerprint(v_n) = SHA-256(hash(v_n) + fingerprint(v_{n-1}))
```
Qualquer adulteração retroativa invalida a cadeia completa.

### Verificação
```typescript
// Verificação de integridade por documento
const result = integrityService.verifyChain(document.versions);
// result: { valid: boolean, invalidAt?: VersionNumber, details: string }
```

---

## Auditoria

### ActivityLog (Imutável)
- Append-only: NUNCA atualizado ou deletado
- Campos obrigatórios: `organizationId`, `userId`, `action`, `resourceType`, `resourceId`, `correlationId`, `requestId`, `timestamp`
- Snapshots: estado completo `before` e `after` para mutações
- TTL: 2 anos (LGPD compliance)

### Correlação de Requests
- `correlationId`: agrupa todas as operações de um fluxo de negócio
- `requestId`: identifica um request HTTP específico
- Propagado em todos os logs gerados durante o processamento

---

## Hardening da Camada Multi-tenant

### Idempotência
- Índice TTL em `idempotency_keys` com janela de 24 horas
- Operações duplicadas dentro da janela retornam resultado da primeira execução
- Chave: `${organizationId}:${operationType}:${idempotencyKey}`

### Outbox Pattern (Event Safety)
- Eventos de domínio são primeiro escritos no banco (transação)
- Worker processa o Outbox e emite os eventos
- Garante que eventos não são perdidos em falhas de processo
- `outbox_events` tabela com status `pending/processed/failed`

---

*Para políticas documentais: [governance/DOCUMENT_POLICY.md](../../governance/DOCUMENT_POLICY.md)*
*Para arquitetura de segurança: [architecture/security/](../../architecture/security/)*
