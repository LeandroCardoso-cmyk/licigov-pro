# Runbook — publicar e vincular a Revisão 2 do `EDITAL_PREGAO_ELETRONICO_BLL` (dados de publicação diferidos)

> **Status: PARA REVISÃO. Nada deste runbook foi executado em produção.** A Revisão 2 é um pacote **candidato** no código (`1.0.2-draft`, catálogo
> `edital-pregao-eletronico-bll/1.0.2-draft.c3`). Registrar, aprovar, publicar e vincular são **decisões humanas distintas**; esta página só descreve como.
> Em nenhum passo: ligar/desligar flag, tocar processo, gerar/emitir documento real, alterar a Revisão 1, executar migration.

## 0. Identificadores exatos (conferir no momento da execução; qualquer divergência ⇒ PARE)

| Item | Valor esperado | Como obter |
|---|---|---|
| Commit em produção | contém `73a3d65a2c43695cd22820cc7c07d198ddc4ad8c` (ou posterior) | Railway → deployment SUCCESS do serviço `licigov-pro` (production) |
| Organização | `organizationId = 1` | — |
| Flag | `FF_INSTITUTIONAL_TEMPLATES_V1` ligada para a org 1 (**não alterar**) | `snapshot` (abaixo) |
| Identidade do modelo | `IDENTITY_ID` (id `ti…`) — anotar | `snapshot` |
| Revisão 1 | `REV1_ID` (id `tr…`), `PUBLISHED`, hash semântico `e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d` | `snapshot` |
| Vínculo ativo | exatamente **1** para a identidade, fixando `REV1_ID`; anotar `BINDING_ID` e as 5 dimensões do escopo (modalidade, forma, plataforma, regime, critério) | `snapshot` |
| Candidata | versão lógica `1.0.2-draft`; hash semântico `33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd`; catálogo `…/1.0.2-draft.c3` | `plan` |
| Fonte jurídica | SHA-256 `6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904` (a mesma da Revisão 1) | `plan` |
| Revisão candidata já registrada? | **não** (nenhuma revisão com o hash da candidata) | `snapshot`/`plan` |

## 1. Responsáveis (decisões humanas)

| Decisão | Quem decide | Papel mínimo no sistema | Observação |
|---|---|---|---|
| D0 — prosseguir com a Revisão 2 | Owner do produto | — | Autoriza cada etapa **separadamente** |
| D1 — conteúdo/ato da **evidência jurídica** | Procuradoria/Jurídico do órgão (competência externa ao sistema) | registra: `manager` | Ver §3. O sistema **não valida competência** (`NOT_VALIDATED_POLICY_PENDING`) e **não inventa** parecer, data ou fundamento |
| D2 — registrar o DRAFT | Operador técnico designado | `operator` + autoridade declarada em arquivo | Ferramenta controlada; só DRAFT + procedência |
| D3 — aprovar | Gestor (≠ operador do D2, recomendado) | `manager` | Decisão distinta de publicar |
| D4 — publicar | Gestor | `manager` | O servidor recalcula a matriz; qualquer `BLOCKED` recusa |
| D5 — vincular (troca atômica) | Gestor | `manager` | Único passo com efeito em produção |
| D6 — retorno à Revisão 1 | Gestor / Owner | `manager` | Mesmo mecanismo do D5 |

## 2. Etapa 0 — pré-verificação (SOMENTE LEITURA)

```
pnpm tsx scripts/register-model-candidate.ts --mode=snapshot --organization-id=1 --json
pnpm tsx scripts/register-model-candidate.ts --mode=plan --organization-id=1 --identity-id=<IDENTITY_ID> --package-version=1.0.2-draft \
  --expect-semantic-hash=33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd \
  --expect-baseline-hash=e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d \
  --expect-source-sha256=6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904
```
(executar num shell com `DATABASE_URL` de produção e o build implantado; ambos os modos apenas leem.)

**PARE se:** qualquer verificação do plano estiver `FALHA`; a identidade não tiver a Revisão 1 `PUBLISHED` com o hash esperado; houver ≠ 1 vínculo ativo
para a identidade; já existir revisão com o hash da candidata em estado inesperado; a flag da org 1 estiver desligada; o commit implantado não contiver o merge `73a3d65a`.
Conferência cruzada opcional (SQL somente leitura, Apêndice A).

## 3. Etapa 1 — evidência jurídica (decisão D1; fora do sistema)

A matriz de prontidão (`LEGAL_APPROVAL_EVIDENCE`) exige **correspondência exata** entre (a) a versão lógica e o SHA-256 da procedência e (b) o hash semântico da **revisão exata**.
Para a candidata: versão lógica `1.0.2-draft`, SHA-256 `6795b2ab…7904`, hash semântico `33ee30bc…63c0cd`.

- A Procuradoria aprovou o Modelo-Mestre `1.0.1-draft` (mesmo SHA-256 da fonte). O rótulo `1.0.2-draft` e a mudança de política de completude (7 dados de publicação deixam de bloquear a
  composição; AST, mapeamento e texto jurídico **idênticos**) **não** têm ato jurídico próprio. **Decisão humana necessária:** (A) a Procuradoria/gestor competente emite novo ato/parecer ou
  declaração que cubra a candidata, ou (B) o Owner decide, com a Procuradoria, que o ato existente cobre o conteúdo idêntico e registra essa base em `basisReference`/`reason`.
- Campos que a pessoa informa (nenhum é preenchido pelo sistema): autoridade declarada (nome, cargo, data do ato, base, motivo) e, **se existirem**, nº do parecer, data, protocolo, procurador e referências.
- **Isto é requisito de PUBLICAÇÃO DO MODELO. Não é, e não pode virar, gate para gerar um Edital** (a composição não consulta parecer, autorização nem módulo jurídico).

## 4. Etapa 2 — registrar o DRAFT (D2, ferramenta controlada)

`authority.json` (preenchido pela pessoa responsável): `{"decidedByName","decidedByRole","decidedAt":"AAAA-MM-DD","basisReference","reason"}`.
```
pnpm tsx scripts/register-model-candidate.ts --mode=execute --organization-id=1 --identity-id=<IDENTITY_ID> --package-version=1.0.2-draft \
  --expect-semantic-hash=33ee…63c0cd --expect-baseline-hash=e622…da5d --expect-source-sha256=6795…7904 \
  --actor-user-id=<ID do operador (membro ativo da org 1, ≥ operator)> --authority-file=authority.json \
  --confirm=REGISTER_CANDIDATE_DRAFT:1:<IDENTITY_ID>:33ee30bc76b7 --allow-production
```
Escreve **somente** uma revisão `DRAFT` (#2) + a procedência. Idempotente: repetir não cria segunda revisão; se um DRAFT ficou sem procedência (falha parcial), a repetição só completa a procedência.
**Verificar:** `snapshot` mostra 2 revisões (Revisão 1 `PUBLISHED` inalterada; candidata `DRAFT`, hash `33ee…`), **1** vínculo ativo ainda fixando `REV1_ID`; UI → Prontidão: `SOURCE_PROVENANCE = PASS`, único `BLOCKED` = `LEGAL_APPROVAL_EVIDENCE`.
**PARE se:** o hash da candidata divergir; aparecer 2ª revisão candidata; o vínculo ou a Revisão 1 mudarem. **Retorno:** nada a desfazer em produção (DRAFT não tem efeito); opcionalmente deixar o DRAFT parado.

## 5. Etapa 3 — evidência (D1 executado) → matriz `READY`
UI `/modelos-institucionais/<IDENTITY_ID>` → Governança (papel `manager`): registrar a evidência com versão lógica `1.0.2-draft` e SHA-256 `6795…7904` + os dados que a pessoa tem.
**Verificar:** Prontidão → `overall = READY` (0 `BLOCKED`); hash da matriz anotado. **PARE** em qualquer `BLOCKED`. Evidência com versão/SHA diferentes mantém o bloqueio (provado em teste).

## 6. Etapa 4 — aprovar (D3) e 7. Etapa 5 — publicar (D4)
UI → Revisões: aprovar a candidata (`DRAFT → APPROVED`), depois publicar (`APPROVED → PUBLISHED`; decisão distinta).
**Verificar:** candidata `PUBLISHED`; **Revisão 1 continua `PUBLISHED`** (publicar não deprecia nada); vínculo ativo **ainda** fixa `REV1_ID` (publicar não troca vínculo); decisão de publicação com `readiness.matrixHash`.
**Ponto de parada seguro:** Revisão 2 publicada e **não vinculada** = nenhum efeito sobre geração. **PARE** aqui até o Owner autorizar o vínculo.
**Retorno:** deixar a Revisão 2 publicada sem vínculo; ou depreciá-la (permitido só sem vínculo ativo).

## 8. Etapa 6 — vínculo (D5, ÚNICO passo com efeito)
UI → Vínculos → "Novo vínculo": selecionar a candidata + o **mesmo escopo (5 dimensões) do vínculo ativo**; a tela avisa "Este escopo já tem vínculo ativo… SUBSTITUÍDO numa única operação atômica" e envia `replacesBindingId = BINDING_ID`.
(Nunca usar "Desativar" + "Criar": deixaria o escopo sem vínculo e a geração voltaria ao legado.)
**Verificar imediatamente:** exatamente **1** vínculo ativo, fixando a candidata, mesmo escopo; o antigo inativo; `bindings.resolve` do escopo → `RESOLVED` para a candidata; preparação de um processo mostra `capabilities.governedDraftRecomposition = true` e os 7 dados como "a preencher depois".
**Efeitos a comunicar:** novas composições usam a Revisão 2 (sem exigir número/cronograma). Rascunhos já compostos pela Revisão 1 continuam válidos (cada M1 aponta a revisão exata; a revalidação usa o M1). Regerar um rascunho existente passa a recompor (nova versão; anterior preservada). **Nenhum documento é gerado por este passo.**
**PARE se:** `BINDING_AMBIGUOUS`, `BINDING_NOT_PUBLISHED`, `SCOPE_INVALID`/escopo diferente, ou ≠ 1 vínculo ativo após a troca.

## 9. Retorno à Revisão 1 (D6) — a qualquer momento
UI → Vínculos → selecionar a **Revisão 1** + mesmo escopo → troca atômica (mesma tela). **Verificar:** 1 vínculo ativo fixando `REV1_ID`; `resolve` → Revisão 1; `capabilities.governedDraftRecomposition = false`.
A Revisão 1 **nunca** é depreciada nem editada neste rollout (permanece publicada e disponível para replay; provado em teste: M1 da Revisão 1 revalida `PASSED` com a Revisão 2 vinculada e após o retorno). A Revisão 2 permanece publicada (sem vínculo) para replay dos M1 que ela compôs.
Dados: nenhum rollback de dados (sem schema/migration; registros do ledger são append-only).

## 10. Critérios de PARE (gerais)
Qualquer divergência de identificador/hash; ≠ 1 vínculo ativo; matriz com `BLOCKED`; erro não previsto em qualquer etapa (não repetir às cegas — consultar `snapshot`); pedido para pular etapa, publicar sem evidência, vincular sem escopo idêntico ou alterar a flag/processo/documentos.

## Apêndice A — conferência SQL somente leitura (org 1)
```sql
SELECT id, slug, display_name FROM institutional_template_identities WHERE organization_id = 1 AND document_kind = 'edital';
SELECT id, identity_id, revision, status, semantic_hash, variable_catalog_version FROM institutional_template_revisions WHERE organization_id = 1 ORDER BY identity_id, revision;
SELECT id, identity_id, pinned_revision_id, active, scope_modality, scope_form, scope_platform, scope_regime, scope_criterion, effective_from_iso FROM institutional_template_bindings WHERE organization_id = 1 AND document_kind = 'edital';
```
