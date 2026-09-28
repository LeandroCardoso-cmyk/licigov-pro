# Decisões humanas pós-NIGHT SHIFT (2026-09-28)

> Registro documental das decisões do owner sobre o NIGHT SHIFT REPORT de 27→28/09/2026.
> O documento **não altera o baseline**:
> - 92 achados, sendo 26 P0 / 54 P1 / 12 P2;
> - `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md`, sha256 `08edc734…0810b3`.
>
> Os achados NEW-00x ficam **fora** do baseline. Nenhuma PR foi aberta, nenhum merge foi feito e a produção não foi alterada.

## 0. Autorização de referência

> "Aprovo o pacote de decisões proposto para R2.2, PR-06, PR-08, PR-09 e PR-12, e autorizo priorizar a triagem/correção
> de NEW-005, NEW-006 e NEW-007 antes da abertura das PRs relacionadas."

A execução estava autorizada a:
- registrar as decisões;
- corrigir branches e criar os branches NEW-005/006/007;
- aprofundar NEW-003/004/015;
- criar migrations **somente em branch e localmente**;
- fazer commit e push de branches não-main.

Nada além disso: nenhuma PR, merge, deploy ou flag.

## 1. Correção factual pós-turno

| Item | Registro no NIGHT SHIFT REPORT | Correção |
|---|---|---|
| Progresso de R2 | linha gráfica: "R2 2/7 oficial (R2.1 PASS, …)" | **R2 oficial = 1/7** (somente R2.1 PASS/MERGED). R2.4 é apenas candidato enquanto a PR-02 não for aberta, revisada, com CI verde, mergeada e validada. |

O NIGHT SHIFT continua válido. O relatório enviado ao humano não é reescrito; esta linha registra a correção.

**Estado oficial:**
- R0 10/10 · R1 9/10 · R2 1/7 · R3 0/6 · R4 0/7 · R5 0/7 · R6 0/6 · R7 0/6 · R8 0/6 · R9 0/10 · R10 0/4 · R11 0/8;
- **20/87 = 23,0%**;
- R1.10 = IN_PROGRESS (não será criado segundo tenant).

## 2. R2.2 — Opção B

Registrada em [`R2_CANONICAL_INGESTION_TENANT_DECISION.md`](R2_CANONICAL_INGESTION_TENANT_DECISION.md) §10, com parâmetros, sequência e gatilhos de rollback.

**Status:** PASS_CANDIDATE · DECISION_RECORDED · RUNTIME_STATE_READONLY_PENDING. A flag **não foi alterada**.

## 3. R2.3

**Status:** BLOCKED_FOR_HUMAN_REVIEW / ENVIRONMENT. Ver [`R2_LEGACY_DATA_USAGE_READONLY.md`](R2_LEGACY_DATA_USAGE_READONLY.md). A PR-03 não foi iniciada.

## 4. PR-06: parecer e contrato (create ≠ reset)

| Tema | Decisão |
|---|---|
| Parecer | Existe **um parecer corrente por workspace/solicitação**. A evolução acontece por rascunho, versões e histórico. Um novo parecer institucional exige uma nova solicitação ou workspace. |
| Número do contrato | **Único por órgão**, qualquer que seja a origem. A origem não pode integrar a chave que permitiria dois contratos oficiais com o mesmo número no mesmo tenant. |
| Normalização do número | Determinística e mínima: trim externo mais regras já existentes e comprovadas. Não remover zeros, não reinterpretar o exercício, não mudar a semântica. Auditar números e formatos existentes antes. |
| Migration de unicidade | Permitida só se for aditiva, na branch, e com preflight de duplicatas. Se houver duplicatas que exijam decisão humana: **BLOCKED_FOR_DATA_REMEDIATION** e nenhuma unique constraint destrutiva. |
| Retry depois de `minuta` | **CONFLICT**. A idempotência não pode mascarar a evolução institucional posterior. |
| RBAC do parecer | **Fora** da PR-06. Vai no branch próprio `fix/new-007-legal-opinion-rbac`, com teste local de compatibilidade e sem misturar commits. |

## 5. PR-08: RBAC e máquina de estados do contrato

| Tema | Decisão |
|---|---|
| `minuta → aditado` | **Proibido**. A exceção do turno noturno é removida. |
| `minuta → apostilado` | **Proibido**. |
| Ativação | Deve existir uma transição **explícita** `minuta → vigente` após a formalização, que seja: auditada, server-side, restrita ao tenant, com papel exigido, com correlação, sem fallback e replay-safe. Antes de implementar, auditar se existe evidência formal canônica de "formalizado". Se não existir, abrir a micro-frente `design/contract-activation-transition` com um contrato técnico proposto, **sem inventar requisito jurídico**. A lacuna de UI não justifica a exceção semântica. |
| Múltiplos instrumentos | Um contrato pode ter múltiplos aditivos e apostilamentos sucessivos. "Aditado" não pode ser um estado que impeça novo aditivo. Preferência: o estado principal reflete o ciclo (minuta, vigente, encerrado, rescindido, arquivado…) e os instrumentos são filhos/históricos. Aplicar a menor correção segura, sem mega-refactor; se o modelo impedir, documentar a dívida. |
| Parecer em aditivo | **Não** fixar em código "todo aditivo de valor exige parecer" nem "nenhum exige". Preservar `requiresLegalOpinion`, governado e fail-closed quando o fluxo exigir. O insumo jurídico fica com a PR-18/PR-20. |

## 6. PR-09: regerar e parâmetros do Edital

| Tema | Decisão |
|---|---|
| Regerar um rascunho | **Sem** justificativa textual obrigatória. Obrigatório: confirmação explícita, mostrar que há edição humana e o que será substituído, preservar o histórico, nenhuma IA antes da confirmação, e cancelar sem nenhum efeito. |
| Documento aprovado/oficial | **Não** regerar diretamente. Exige um novo ciclo de versionamento governado. |
| Critério de julgamento e regime de execução | **Devem ser persistidos**: são fatos institucionais, não estado de UI, default ou inferência. Se faltarem no schema, criar migration **aditiva** na branch. Registros antigos ficam NULL / "requer revisão", sem valor fabricado. Testar: DB limpo, DB migrado, reexecução da migration, hidratação, reload, regeneração e imutabilidade do oficial. |

## 7. PR-12: contrato vigente só muda por instrumento

| Tema | Decisão |
|---|---|
| Vigência | Travada fora de `minuta`. Mudança posterior só por instrumento ou workflow governado. |
| Gestor e fiscal | O editor genérico `updateContract` **não** pode alterá-los depois de `minuta` (fail-closed). A troca futura exige uma ação específica, auditada e com nome semântico; fica registrada como dívida/capability futura. |
| CAS | Mantém `expectedUpdatedAt` e `CONTRACT_REVISION_CONFLICT`. Um update com revisão desatualizada não grava nada. |

## 8. Prioridade absoluta: NEW-005 / NEW-006 / NEW-007 (fora do baseline)

| Achado | Branch | Severidade candidata | Regra aprovada |
|---|---|---|---|
| NEW-005A `directProcurement.ratify` aberto a viewer | `fix/new-005-direct-procurement-rbac` | **P0 AUTHORITY** | Piso técnico manager+ |
| NEW-005B `directProcurement.publish` aberto a viewer | idem | **P0 AUTHORITY** | Piso técnico manager+ |
| NEW-005C demais mutações da Contratação Direta abertas a viewer | idem | P1 RBAC/GOVERNANCE | leitura: tenant · rascunho e evidência: operator+ · configuração de workflow (`configureFlags`): manager+ |
| NEW-006 mutações do `contractWorkspace` abertas a viewer | `fix/new-006-contract-workspace-rbac` | P1; um subcaso pode ser P0 se executar decisão oficial sem segundo gate | leitura: tenant · rascunho, ocorrência e solicitação: operator+ · mudança de estado e decisão: manager+ · criação de instrumento: operator+ se só produz rascunho, manager+ se também muda o estado |
| NEW-007 `legalOpinionWorkspace.*` aberto a viewer | `fix/new-007-legal-opinion-rbac` | **P0 AUTHORITY** para `signOpinion`; P1/P0 para as demais conforme o efeito | operator+ **e** atribuição válida ao workspace; owner, admin e platform admin não viram procurador sem atribuição; `receiveRequest` sem autoatribuição por viewer e sem sobrescrita silenciosa |

**Nota obrigatória:** manager+ é **apenas um piso técnico de RBAC**. Não declara que o manager seja juridicamente a autoridade competente. Autoridade competente, `decidedBy` × `recordedBy` e segregação de funções continuam na **PR-07**.

**Ordem:** a PR-02, que desativa `directProcurement.updateStage` (LEG-011), entra antes da NEW-005.

## 9. Aprofundamentos sem correção nesta execução

- NEW-003: exportação LGPD com colunas secretas.
- NEW-004: ids de evento derivados de contagem.
- NEW-015: flag percentual aleatória.

Os resultados estão em §11.

## 10. Exceção registrada: hook Graphify

- **Instrução do owner:** usar o hook normal. Se ele gerar artefato fora de escopo, não desabilitar silenciosamente: diagnosticar e registrar a exceção antes.
- **Diagnóstico (2026-09-28):** numa cópia **não modificada** de `origin/main` (`5cd9d50`), `tools/graphify/run.sh update .` (graphifyy 0.9.32, a toolchain fixada) reescreve os 4 artefatos versionados de `graphify-out/` com **+39.458 / −11.255 linhas**.
- **Causa:** o grafo commitado está defasado em relação à main desde as PRs #256–#262, que entraram sem regenerá-lo.
- **Efeito se o hook rodasse:** cada commit de código injetaria esse drift alheio ao escopo, e todos os pares de branches conflitariam em `graph.json`.
- **Exceção:**
  - commits de código desta execução usam `git -c core.hooksPath=/dev/null`, com a linha `Graphify pre-commit skipped (registered exception …)` no corpo;
  - commits só de docs usam o hook normal (que não faz nada, porque não tocam `server/` nem `client/`).
- **Tratamento proposto:** uma única regeneração do grafo, numa PR própria, depois da integração das branches.

## 11. Achados novos (fora do baseline), com triagem

*(Preenchido ao final da execução; ver §11 abaixo.)*
