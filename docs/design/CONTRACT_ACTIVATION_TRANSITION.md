# Transição de ativação do contrato (`minuta → vigente`)

> **PROPOSTA — NÃO DEFINIDA JURIDICAMENTE.**
> Este documento descreve um **contrato técnico** para uma transição institucional explícita. Ele **não**
> estabelece requisitos legais. Toda precondição marcada como `[A DEFINIR — jurídico/responsável pelo produto]`
> é um espaço reservado, e nada aqui deve ser implementado com um valor inventado para esses campos.
> Donos do insumo jurídico: PR-18 / PR-20. Competência/autoridade e segregação de funções: PR-07.

- Origem: PR-08 rev. 2 (branch `fix/r4-pr08-rbac-state-machine`), decisão B do responsável pelo produto.
- Relacionados: SEM-025 (PR-08: aditivo/apostilamento pela máquina de estados), SEM-023 (PR-12: edição
  governada do contrato), NEW-006 (RBAC do `contractWorkspaceRouter`).

## 1. Decisão do responsável pelo produto

1. `minuta → aditado` e `minuta → apostilado` **não são permitidos**. Aditivo/apostilamento sobre contrato em
   `minuta` é recusado com `BAD_REQUEST` + `CONTRACT_STATUS_TRANSITION_INVALID`, sem efeitos (implementado na
   PR-08 rev. 2; a exceção temporária `minuta_pending_human_decision` foi removida).
2. A ativação `minuta → vigente` deve ser uma **transição institucional explícita** após a formalização:
   explícita, auditada, no servidor, isolada por tenant, com piso de papel, com `correlationId`, sem fallback
   e segura contra replay.
3. A PR-08 **não** mantém a exceção de `minuta` para compensar a ausência dessa transição.

## 2. Auditoria: existe evidência formal canônica de "formalizado"?

**Resultado: NÃO.** Hoje, nenhum dado do domínio de Contratos (nem do Document Engine para Contratos) prova
que um contrato foi formalizado, assinado ou publicado. Por isso a transição **não** foi implementada nesta
branch. O que existe:

| # | O que existe | Onde | Serve como evidência de formalização? |
|---|---|---|---|
| 1 | A máquina já lista `minuta → vigente` | `server/domain/contractWorkspace.ts:55-56` (`STATUS_TRANSITIONS`) | Não. É só a aresta do grafo, sem precondição. |
| 2 | Caminho genérico de status em `updateContract` (`status` opcional no input; `transitionContractStatus`) | `server/routers/contractWorkspaceRouter.ts:160-179` (input `:165`, transição `:173-176`) | Não. É uma edição genérica: não pede evidência, não grava evento de timeline/auditoria próprio e não é idempotente. Nenhum cliente envia `status` (`client/src/components/contract-workspace/ContractEditor.tsx` não usa o campo). Na branch NEW-006 o status passa a exigir `manager`; na PR-12 o save passa por CAS de revisão. Nenhuma das duas cria evidência de formalização. Ver §7 (achado NEW). |
| 3 | Todo fluxo de nascimento cria `minuta` | `server/domain/contractWorkspace.ts:95`; `server/services/contractService.ts:118` (avulso), `:139` (importado); processo/contratação direta usam o default | Não. Confirma que, sem uma transição explícita, nenhum contrato sai de `minuta`. |
| 4 | Documento oficial do contrato no Document Engine | `server/services/contractService.ts:200` (`generateOfficialDocument` sem `status`) ⇒ `server/domain/officialDocument.ts:114` (default `"gerado"`); estados possíveis em `server/domain/officialDocument.ts:29` (`gerado`/`revisado`/`emitido`) | Não. Documentos de Contratos nascem e ficam `gerado`. Não há caminho que os leve a `emitido`. |
| 5 | Emissão oficial governada (`emitido`) | `server/services/documentPromotionService.ts:34-35` (só `etp`/`tr`/`edital` do Processo Licitatório); política de exportação `server/services/officialDocumentExportAdapter.ts:98-101` (só `processo_licitatorio` e `parecer_juridico`) | Não para Contratos. Pode servir de **padrão** de implementação (SoD, hash de conteúdo, idempotência, ledger). |
| 6 | Parecer jurídico assinado ⇒ versão `emitido` | `server/services/legalOpinionWorkspaceService.ts:318-329` (materialização), `:402` (`signOpinion`) | Não. É evidência de **parecer**, não de assinatura/formalização do contrato. |
| 7 | Tabela `digital_signatures` com `documentType = "contract"` | `drizzle/schema.ts:1468-1490` | Não. `documentId` é `int` (módulo legado `contracts`, PK int em `drizzle/schema.ts:1223`); `contract_workspaces.id` é `varchar(20)`. O repositório é órfão/inalcançável segundo `server/kernel/architecture/legacyBoundaries.ts:224`. |
| 8 | `signedAt` em aditivos/apostilamentos legados | `drizzle/schema.ts:1307`, `:1344` (`contract_amendments`, `contract_apostilles`, módulo legado) | Não. Pertence ao módulo legado `contracts`, não ao Contract Workspace. |
| 9 | Colunas de formalização em `contract_workspaces` | `drizzle/schema.ts:5933-5951` | Não existem (sem `signed_at`, `formalized_at`, `published_at` nem referência a ato). |

## 3. Contrato técnico proposto

### 3.1 Comando

`contractWorkspace.activateContract`, uma mutation **dedicada**. Não é um campo de `updateContract` (ver §7).

Input (Zod, estrito):

| Campo | Tipo | Observação |
|---|---|---|
| `contractId` | `string` (min 1) | Resolvido **sempre** com o `organizationId` do contexto (tenant). |
| `idempotencyKey` | `string` (min 12) | Replay-safe (padrão `idempotencyService`, como `createManual`). |
| `expectedUpdatedAt` | `string` datetime | CAS de revisão (mesma primitiva da PR-12). |
| `formalizationEvidence` | objeto | **Formato `[A DEFINIR — jurídico/responsável pelo produto]`**. Candidatos técnicos, nenhum decidido: id de documento oficial do contrato em `emitido`; referência ao ato de assinatura (data, signatários); referência à publicação/divulgação. |
| `reason` | `string` opcional | Texto livre auditável. |

Saída: `{ workspace, activation: { id, activatedAt, activatedBy, evidenceRef }, replayed: boolean }`.

### 3.2 Precondições

Todas avaliadas no servidor, **antes de qualquer escrita**, sem default que decida no lugar do humano:

1. Contrato existe no tenant do contexto ⇒ senão `NOT_FOUND` (mesma mensagem de `requireContract`).
2. `canContractTransition(ws.status, "vigente")` e `ws.status === "minuta"` ⇒ senão `BAD_REQUEST`
   `CONTRACT_STATUS_TRANSITION_INVALID`. Um contrato encerrado/rescindido/arquivado nunca reabre.
3. `expectedUpdatedAt === ws.updatedAt` ⇒ senão `CONFLICT` `CONTRACT_REVISION_CONFLICT` (PR-12).
4. Evidência de formalização presente e **válida** ⇒ senão `PRECONDITION_FAILED`
   `CONTRACT_ACTIVATION_EVIDENCE_REQUIRED`. **Critério de validade `[A DEFINIR — jurídico/responsável pelo produto]`.**
5. Campos mínimos do contrato preenchidos (ex.: contratado, objeto, valor, vigência) ⇒
   **lista `[A DEFINIR — jurídico/responsável pelo produto]`**. Enquanto não for definida, **nenhuma** lista é
   aplicada por default.
6. Parecer jurídico prévio exigido? **`[A DEFINIR — PR-18/PR-20]`**. Se o fluxo passar a exigir, a recusa é
   fail-closed (`PRECONDITION_FAILED` `CONTRACT_ACTIVATION_LEGAL_OPINION_REQUIRED`).
7. Autoridade competente / segregação de funções (ex.: quem ativa ≠ quem redigiu a minuta)
   **`[A DEFINIR — PR-07]`**.

### 3.3 RBAC

- **Piso técnico: `manager`** (`orgRoleProcedure("manager")`). É só um piso técnico e **não** representa a
  autoridade legalmente competente (item 7 acima). Isso é coerente com o piso de mudança de status proposto
  em NEW-006.
- `viewer`/`operator` ⇒ `FORBIDDEN` antes de qualquer leitura de evidência ou escrita.

### 3.4 Efeitos (uma transação)

1. `compareAndSetContractWorkspaceStatus({ fromStatus: "minuta", toStatus: "vigente" })`, a mesma primitiva CAS
   de SEM-025. Se o CAS não casar ⇒ ROLLBACK e reavaliação: recusa da máquina ou `CONFLICT`.
2. Registro de ativação append-only (tabela nova **proposta**, `contract_activations`: `id`,
   `organization_id`, `contract_id`, `activated_by`, `activated_at`, `evidence_ref` (JSON),
   `reason`, `correlation_id`, com `UNIQUE (organization_id, contract_id)`). Exige migration aditiva
   (próximo número livre na integração), com preflight de duplicatas. Linhas antigas: nenhuma. Não há
   backfill de decisões inventadas.
3. Evento de timeline `eventType: "change"`, `actor: "user:<id>"`, com resumo "Contrato ativado (minuta → vigente)",
   `refId` = id da ativação e `correlationId` do contexto.
4. Chave de idempotência marcada `COMPLETED` na mesma transação (padrão de `documentPromotionService`).

Garantias: sem IA, sem geração de minuta e sem notificação no caminho de recusa. O log estruturado
(`serviceLogger`) grava `contract_activation_refused` / `contract_activation_committed` com `organizationId`,
`contractId`, `actorUserId` e `correlationId`.

### 3.5 Idempotência / replay

- Mesma chave e mesmo payload ⇒ `replayed: true`, sem nova linha nem novo evento.
- Mesma chave com payload diferente ⇒ `CONFLICT`.
- Duas ativações concorrentes ⇒ uma vence o CAS; a outra recebe `CONFLICT` ou, se o contrato já estiver
  `vigente`, `BAD_REQUEST` `CONTRACT_STATUS_TRANSITION_INVALID`, porque `vigente → vigente` não é ativação.
- `UNIQUE (organization_id, contract_id)` em `contract_activations` é a segunda barreira.

### 3.6 Tokens de erro (estáveis, não traduzir)

| Token | Código tRPC | Quando |
|---|---|---|
| `CONTRACT_STATUS_TRANSITION_INVALID` | `BAD_REQUEST` | status atual ≠ `minuta` ou máquina recusa |
| `CONTRACT_REVISION_CONFLICT` | `CONFLICT` | `expectedUpdatedAt` divergente (PR-12) |
| `CONTRACT_ACTIVATION_EVIDENCE_REQUIRED` | `PRECONDITION_FAILED` | evidência ausente ou inválida (critério a definir) |
| `CONTRACT_ACTIVATION_LEGAL_OPINION_REQUIRED` | `PRECONDITION_FAILED` | só se PR-18/PR-20 definirem a exigência |
| — | `FORBIDDEN` | papel abaixo do piso técnico |
| — | `NOT_FOUND` | contrato de outro tenant ou inexistente |

### 3.7 Testes a escrever (quando implementado)

- Unitários de domínio: somente `minuta` ativa; encerrado/rescindido/arquivado/vigente/aditado/apostilado
  recusados; status desconhecido fail-closed.
- Router (mock): `viewer`/`operator` ⇒ `FORBIDDEN` com zero leituras e zero escritas; `manager+` ativa;
  `organizationId` sempre do contexto; cada token da §3.6.
- MySQL real (entrar em `test:smoke:security`): efeitos atômicos (status + ativação + timeline + chave de
  idempotência); recusa sem nenhuma escrita (snapshot de `contract_workspaces`, `contract_activations`,
  `process_timeline`, `official_documents`); replay com a mesma chave; conflito com chave e payload
  diferentes; corrida real (duas ativações ⇒ uma vence); cross-tenant ⇒ `NOT_FOUND`; `correlationId`
  persistido no evento; nenhuma chamada de IA.
- Regressão SEM-025: após ativar, aditivo/apostilamento passam a ser admitidos (`vigente → aditado/apostilado`).

## 4. Instrumentos sucessivos (decisão C): estado atual e dívida de modelo

- A máquina (`STATUS_TRANSITIONS`) trata `aditado` e `apostilado` como **status do contrato**. Não existe
  status `suspenso`.
- Correção mínima aplicada na PR-08 rev. 2: todo estado pós-formalização não terminal (`vigente`, `aditado`,
  `apostilado`) admite um novo aditivo ou apostilamento. Quando o status já é o do instrumento, o registro é
  feito sem transição (`unchanged`). Testes de cadeia: `vigente → aditivo → aditivo → apostilamento →
  aditivo → apostilamento → aditivo com parecer`.
- **Dívida / modelo proposto (não implementado, de propósito):** o status principal deveria ser só o
  **ciclo de vida** (`minuta`, `vigente`, `encerrado`, `rescindido`, `arquivado` e, se o jurídico definir,
  `suspenso`). Aditivos e apostilamentos seriam **filhos/histórico** (`contract_addenda`,
  `contract_ws_apostilles`, que já existem com `sequence`). "Aditado"/"apostilado" passariam a ser
  **indicadores derivados** (ex.: "possui N aditivos"), e não estados. A migração exige um plano de dados
  (reclassificar `aditado`/`apostilado` → `vigente` com marca derivada) e revisão das telas que filtram por
  status (`ContractOverview.tsx`, `labels.ts`). Não foi feita para não criar uma nova máquina de estados sem
  decisão.
- Concorrência de instrumentos sucessivos: o id do instrumento é determinístico por sequência
  (`server/domain/contractInstruments.ts`). No caminho governado, a PR-08 rev. 2 grava com INSERT puro:
  duas criações concorrentes com a mesma sequência ⇒ a segunda recebe `CONFLICT` e nada é gravado, sem fundir
  as duas numa linha híbrida. A numeração continua sendo calculada fora da transação (contagem). Uma
  numeração atômica (lock por contrato) é melhoria futura.

## 5. Parecer jurídico em aditivos (decisão D): estado atual e dívida

- `requiresLegalOpinion` é calculado em `createAddendum` pela regra **pré-existente** do "Adaptive Process
  Engine": `valor`/`quantitativo` ⇒ exige; `prazo`/`qualitativo` ⇒ não exige
  (`server/services/contractService.ts:336`). Essa regra **não foi definida juridicamente** nesta PR. Ela foi
  apenas preservada. PR-18/PR-20 são donas do insumo jurídico e devem substituí-la por configuração governada.
- Fail-closed aplicado (o gancho existe, no próprio `createAddendum`): quando o fluxo exige parecer, o aditivo
  é gravado `aguardando_parecer` e o **status do contrato não é efetivado**
  (`deferred_pending_legal_opinion`). O evento de timeline e o log estruturado registram essa escolha.
- **Dívida:** não existe comando de finalização `aguardando_parecer → finalizado`. `advanceAddendum` só é
  usado na criação, e `legalOpinionRequestId` nunca é gravado
  (`server/domain/contractInstruments.ts:66`). Também não há vínculo entre `requestLegalOpinion` do
  contrato e um aditivo específico. Quando PR-18/PR-20 entregarem o insumo, o comando proposto é
  `finalizeAddendum` (piso técnico `manager`, parecer vinculado e `emitido`, CAS de status via
  `planInstrumentStatusChange` sem a flag, evento de timeline, idempotência). Até lá, um aditivo que exige
  parecer não altera o status do contrato.

## 6. Questões abertas (humanas)

1. Qual evidência formal caracteriza "formalizado" (assinatura, publicação, documento `emitido`, outra)?
2. Quais campos mínimos do contrato são obrigatórios para ativar?
3. A ativação exige parecer jurídico prévio? Em que casos?
4. Quem é a autoridade competente para ativar? Há segregação de funções em relação ao autor da minuta (PR-07)?
5. O modelo "status = ciclo de vida; instrumentos = histórico" (§4) é aprovado? Existe `suspenso`?
6. Quais tipos de aditivo exigem parecer (hoje: regra pré-existente valor/quantitativo) e qual é o comando de
   finalização pós-parecer?

## 7. Achado relacionado (não corrigido nesta PR)

`contractWorkspace.updateContract` aceita `status` e aplica qualquer transição da máquina, inclusive
`minuta → vigente`, sem evidência, sem evento de timeline/auditoria dedicado e sem idempotência
(`server/routers/contractWorkspaceRouter.ts:160-179`). Nenhuma tela usa esse caminho, mas ele é alcançável
por API: por qualquer membro do tenant em `main`, e por `manager+` após NEW-006. É exatamente o "fallback" que
a decisão B quer evitar. Tratamento proposto, na integração de PR-12 + NEW-006 + a transição de ativação:
recusar `status` em `updateContract` para `minuta → vigente` (e, idealmente, para qualquer mudança de
ciclo de vida), direcionando para o comando dedicado. Não foi alterado aqui porque as linhas pertencem a
PR-12 (SEM-023) e NEW-006, e porque retirar o único caminho de ativação antes de existir o comando dedicado
exige decisão humana.
