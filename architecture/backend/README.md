# Backend Architecture

## Stack

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Runtime | Node.js | 20+ |
| Framework | Express | 4.x |
| API | tRPC | v11 |
| ORM | Drizzle | latest |
| Banco | MySQL 8 | Railway |
| Auth | JWT + bcrypt | — |
| Testes | Vitest | 2.x |
| Build | esbuild | — |

## Estrutura de Pastas

```
server/
├── config/           # env, app, aws, ai
├── db/               # connection, repositories
├── domain/           # tipos, regras, invariantes
├── parsers/          # motor de importação
├── services/         # lógica de negócio
├── trpc/             # routers, procedures, middleware
├── bootstrap.ts      # migrations + safety nets + seed
└── __tests__/
    └── integration/  # testes por sprint
```

## Padrão de Serviço

```typescript
// 1. Verificar DB disponível
const db = await getDb();
if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

// 2. Verificar organizationId (SEMPRE)
const orgId = ctx.organizationId;
if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

// 3. Verificar existência do recurso
const entity = await findById(id, orgId);
if (!entity) throw new TRPCError({ code: "NOT_FOUND" });

// 4. Executar operação
await db.update(...).where(and(eq(...id), eq(...orgId)));

// 5. Logar atividade
await logActivity({ organizationId: orgId, ... });
```

## TrpcAuditCtx

Contexto obrigatório em todas as procedures de negócio:

```typescript
interface TrpcAuditCtx {
  user: { id: number; name?: string; email?: string };
  organizationId: number | null;
  orgMembership?: { role: OrgRole };
  correlationId?: string;
  requestId?: string;
}
```
