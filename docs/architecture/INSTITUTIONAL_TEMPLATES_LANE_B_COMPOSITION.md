# Institutional Templates — Lane B: composição, manifests e emissão

> **Base:** `ba7b91d` (T1 + G0 oficial PASS + HD-26 `OPTION_A`). **Escopo:** núcleo cognitivo determinístico e integração controlada com geração/emissão. Persistência física (tabelas, migration 0316, FKs compostas) é da **Lane A**; esta lane depende só de **ports**. Nenhum tenant é habilitado; nenhuma feature flag, router, frontend ou schema foi alterado.

## Fluxo

```
dados canônicos do domínio → revisão EXATA (binding com pin) → composição determinística
→ narrativas de IA supervisionadas (só aiSlot) → M1 → revisão/edição humana
→ revalidação canônica → M2 → promoção/emissão oficial
```

| Peça | Onde | Natureza |
|---|---|---|
| Composer, resolução de variáveis, render, M1 | `server/domain/institutionalTemplates/composer.ts` | puro |
| Revalidação canônica, M2 | `server/domain/institutionalTemplates/revalidation.ts` | puro |
| Ports (contrato com a Lane A) | `server/services/institutionalTemplates/ports.ts` | interfaces + padrão fail-closed |
| Orquestração (geração e hook de emissão) | `server/services/institutionalTemplates/templateCompositionService.ts` | serviço |
| Integração na emissão | `promoteOfficialDocument({ …, templateIssuance? })` | parâmetro opcional; ausente ⇒ comportamento idêntico |

## Regras implementadas

- **Pin exato:** a composição exige `identityId + revisionId + semanticHash`; sem pin, vazio ou `latest` ⇒ `BINDING_REVISION_NOT_PINNED`. Binding ambíguo ⇒ `TEMPLATE_BINDING_AMBIGUOUS` (nenhum é escolhido). Só `PUBLISHED` gera; `DEPRECATED` só recompõe na revalidação (`DEPRECATED ≠ INVALID`).
- **Template = forma, domínio = verdade:** valores só pelas fontes canônicas, via catálogo (`source` + `path` do catálogo, leitura só de propriedades próprias). Obrigatório ausente ⇒ `MISSING_REQUIRED`; tipo divergente ⇒ `VALUE_TYPE_INVALID`; opcional ausente ⇒ `[REVISAR: …]` (bloqueia a emissão). Formatação determinística (dinheiro, número, data, lista).
- **Condições:** só a DSL do T1, sobre os valores canônicos. Cada decisão vai ao M1 com `traceHash`. Sem `eval`, JS, SQL, rede, regex dinâmica, IA ou include recursivo.
- **IA:** só em `aiSlot`, com a narrativa já produzida (`executionId` auditável). Não escolhe template, revisão, condição, fato, número, regra, aprovação, publicação ou emissão. Estrutura Markdown no início de linha é neutralizada; valor monetário fora do quadro canônico recebe `[REVISAR…]`. O M1 registra `humanAccepted = false`; a emissão exige aceite humano **exato** (slot + execução + hash do texto).
- **Referências oficiais:** `docRef` só com pin exato do **mesmo** tenant (`documentId + lineageId + version + contentHash`), registradas uma vez por tipo, com `role`, `order` e `title`; sem render mode.
- **M1:** selado com `templateSemanticHash`, `catalogVersion`, fontes (`srcd:<chave>=<sha256 do snapshot>`), `officialDocRefs`, `conditionalDecisions`, `aiNarratives`, `annexes`, `identityFingerprint`, `composedOutputHash = sha256(texto)` e `manifestHash`. O id é derivado do conteúdo semântico, e `createdAt` fica fora do hash. O resultado é imutável (deep freeze).
- **Revalidação (antes da transação):** recompõe com as fontes **atuais**, a mesma revisão e as mesmas narrativas, e bloqueia:
  - `SOURCE_CHANGED` (fonte, documento oficial referenciado ou identidade);
  - `COMPOSITION_DRIFT`;
  - `HUMAN_EDIT_LINEAGE_INVALID`;
  - `PROTECTED_NODE_MISSING` (valor canônico ou referência removidos);
  - `STRUCTURAL_DEVIATION_UNACKNOWLEDGED`;
  - `AI_NARRATIVE_NOT_ACCEPTED`.

  Nunca regenera, nunca muta documento emitido.
- **M2:** derivado do M1 (o M1 não é reescrito), com `derivedFromManifestId`, `documentContentHash`, `humanEditRefs` (a cadeia contígua tem que terminar no conteúdo emitido) e `canonicalRevalidation` (`checkedAt` fora dos hashes). O id é determinístico por (M1, conteúdo).
- **Transações e SEM-084:**
  - Geração: rascunho + versão `gerado` pelo `documentEngineService.generateOfficialDocument` + M1 numa única transação, com `runTransactionWithDeadlockRetry`.
  - Emissão: o M2 é gravado dentro da transação da promoção, ao lado da versão `emitido`, do ledger e da idempotência.
  - Deadlock ⇒ a transação **inteira** é repetida, sem efeito parcial.
  - Replay das mesmas entradas ⇒ mesmo M1 e nenhuma escrita.

## Contrato dos ports para a Lane A

| Port | Exigência |
|---|---|
| `enablement` | padrão `false` para todo tenant |
| `revisions` / `bindings` | leitura tenant-scoped; nunca "latest" |
| `catalogs` | registro de código versionado (não é tabela) |
| `canonical` | snapshots por fonte e pins oficiais do mesmo tenant; leitura fora de transação |
| `drafts` | `reserveDraftId` antes da transação; `writeDraft(executor)` dentro dela |
| `manifests` | INSERT-only; `insert*` usam o `executor` da transação do chamador; FK composta de tenant (HD-26) |
| `review` | saídas de IA por `executionId`, aceites, reconhecimentos de desvio e cadeia de edições humanas |
| `transactions` | `createTemplateTransactionPort()` (getDb + retry SEM-084) |

`createUnavailableTemplatePorts()` é o estado atual: desabilitado, e qualquer outra chamada falha fechado com `TEMPLATE_PERSISTENCE_UNAVAILABLE`.

## Fora de escopo

Schema, migration 0316, FKs, frontend, routers, `/templates` legado, publicação externa (PNCP/BLL/Diário), habilitação de tenant e feature flags.
