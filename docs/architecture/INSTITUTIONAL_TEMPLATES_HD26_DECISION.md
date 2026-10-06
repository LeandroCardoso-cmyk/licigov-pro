# HD-26 — Relações tenant-safe do bounded context Institutional Templates

> **Registro de decisão do owner (2026-10-06).** Este documento só registra a decisão. Nenhuma migration, tabela, DDL, tooling ou código de persistência foi criado: a T2 **não** foi iniciada.
> **Contexto:** G0 oficial = PASS, 0 `DELTA_CONTRADICTORY`, `T2_RELEASED_CONCEPTUALLY = TRUE` (ver `docs/audits/TEMPLATE_G0_OFFICIAL_DELTA_CHECKLIST.md`, seção 5). Base: `main` `c88c853`.
> **Invariante (INV-TPL-36, congelada):** `CROSS_TENANT_RELATIONSHIP_MUST_BE_IMPOSSIBLE`. A decisão abaixo fixa o **mecanismo**.

```
HD26_STATUS = DECIDED
HD26_DECISION = OPTION_A
HD26_NEW_TABLE_RELATIONS = COMPOSITE_TENANT_FK
HD26_EXISTING_TABLE_RELATIONS = SAME_TRANSACTION_FAIL_CLOSED_VALIDATION
HD26_EXISTING_PARENT_DDL = NOT_AUTHORIZED
HD26_CASCADE_DELETE = FORBIDDEN
HD26_SCHEMA_GUARD_EXTENSION = REQUIRED
```

**Não reabrir esta decisão durante a T2 sem nova evidência material.**

## 1. Relações entre tabelas NOVAS

- Garantia **estrutural no banco**, ciente do tenant.
- Identidade referencial obrigatória: `organization_id + entity_id`.
- No pai: `UNIQUE (organization_id, id)`. No filho: índice correspondente à FK composta.
- Uma FK nunca relaciona registros de organizações diferentes.

## 2. Sem plataforma-global

- V1 permanece **organization-only**: `organization_id NOT NULL` em todas as tabelas institucionais novas.
- Proibido interpretar `NULL = GLOBAL`. `PLATFORM_GLOBAL` não existe.

## 3. Política de DELETE / UPDATE

- **Proibido** `ON DELETE CASCADE` e `ON UPDATE CASCADE` como mecanismo genérico.
- Preferir `RESTRICT` / `NO ACTION` (ou o equivalente do MySQL).
- Motivo: preservar lineage, replay, manifest, auditoria, decisões e referências históricas. Remoção e depreciação são governadas pelo domínio, nunca por cascade físico implícito.

## 4. Relações com tabelas produtivas EXISTENTES

Aplica-se, conforme couber, a `official_documents`, `generated_documents`, `institutional_decisions` e `official_document_artifacts`.

- **Não** alterar essas tabelas na T2 só para adicionar `UNIQUE (tenant, id)` ou FK composta. Nenhum DDL por inferência.
- A referência é validada de forma **fail-closed na MESMA transação** da escrita da relação:
  - a consulta usa **simultaneamente** `id` **e** tenant/organização;
  - com lock apropriado quando necessário (por exemplo `FOR SHARE`);
  - o tenant vem do **contexto institucional autoritativo** ou da **entidade já persistida**, nunca de valor enviado livremente pelo cliente;
  - referência existente em **outro** tenant é inválida e **jamais** persistida.

## 5. Garantia exigida da T2

| Relação | Prova exigida |
|---|---|
| entre tabelas novas | proteção estrutural no banco **+** validação de serviço/domínio |
| nova → tabela existente | validação fail-closed na mesma transação **+** lookup com escopo de tenant **+** testes adversariais em MySQL real |

Validação apenas em frontend ou router **não** é aceita. O contrato de domínio já existe no T1: `sameOrganizationIssues` / `CROSS_TENANT_REFERENCE` (`server/domain/institutionalTemplates/tenant.ts`).

## 6. Primeira convenção de FK do repositório

Hoje o repositório tem **zero FKs** e os gates (`schema-audit`, `db-push-guard`) não reconhecem FK. A T2 deve vir com **extensão mínima** desses mecanismos, estendendo/compondo a infraestrutura existente. **Não** criar um segundo sistema de validação de schema.

O gate deve detectar, no mínimo, para as FKs críticas do novo bounded context:

1. FK ausente;
2. FK apontando para a coluna errada;
3. tenant ausente da FK composta;
4. índice/UNIQUE do pai incompatível;
5. regra `ON DELETE` indevida;
6. estado parcial de migration.

## 7. Migration 0316 (futura; NÃO autorizada nesta execução)

Poderá criar as estruturas de Templates aprovadas, e deverá ser:

- aditiva;
- deterministicamente replay-safe;
- multi-tenant;
- forward-compatible;
- sem alteração destrutiva de tabelas existentes;
- validada: fresh, `0315 → 0316`, replay/no-op e contra estado parcial de migration;
- testada em MySQL real.

## 8. Não autorizado nesta fase

```
ALTER official_documents ADD UNIQUE(tenant_id,id)
ALTER generated_documents ...
ALTER institutional_decisions ...
```

ou equivalente apenas para suportar FK estrutural de Templates. Se a implementação demonstrar que algo disso é **indispensável**: `STOP_FOR_OWNER_DECISION`, com evidência.

## 9. Notas técnicas para o planejamento da T2 (derivadas do schema real; não são decisões novas)

- FK composta no MySQL exige índice no pai sobre as colunas referenciadas e **charset/collation idênticos**. As tabelas modernas já declaram `utf8mb4_unicode_ci` explicitamente; as novas devem fazer o mesmo.
- Ids existentes: `official_documents.id`/`generated_documents.id` = `varchar(20)`; `institutional_decisions.id`/`official_document_artifacts.id` = `varchar(24)`; `organizations.id` = INT.
- Coluna de tenant: `tenant_id` (`official_*`) × `organization_id` (`generated_documents`, `institutional_decisions`). Nas tabelas novas é sempre `organization_id`, com o mesmo valor de `organizations.id`.
- Em FK composta, se uma coluna do filho for NULL a FK não é verificada (`MATCH SIMPLE`). Relação **obrigatória** exige coluna `NOT NULL`; relação opcional é aceitável com NULL, mas então a ausência da relação é explícita.
- Os deltas do SEM-084 (retry de deadlock) envolvem a transação da promoção e a de `createDocument`. A escrita de manifest e relações da T2 deve ficar **dentro** dessa transação, para ser repetida inteira.
