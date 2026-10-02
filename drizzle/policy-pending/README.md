# drizzle/policy-pending — SQL preparado que depende de DECISÃO HUMANA

Nada aqui está no `meta/_journal.json`; nada é aplicado por `db:migrate`/`db:migrate:release`. Cada arquivo só pode
virar migration numerada (próximo número livre da cadeia) depois da decisão registrada.

| Arquivo | Decisão | Estado |
|---|---|---|
| `contract_number_scope_A_unique_per_org.sql` + `preflight_contract_number_scope_A.sql` | CONTRACT_NUMBER_SCOPE (HD-15): número do contrato único por órgão, qualquer origem | BLOCKED_HUMAN_DECISION |

Opção B de HD-15 (único por órgão **e** origem) é o comportamento atual: a PRIMARY KEY `id` = hash(org, origem, número)
com criação INSERT-only (PR-06). Nenhum SQL é necessário.
