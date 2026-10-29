# Contrato de Autoridade Institucional (SECURITY-02)

> **Acesso técnico da plataforma não é autoridade do órgão.**
> Um usuário com `users.role = 'admin'` que informa `X-Organization-Id` recebe do `resolveTenant`
> (`server/_core/trpc.ts`) uma projeção **sintética** de membership `owner` (`id: 0`), marcada com
> `ctx.platformAdminAccess = true`. Ela serve a suporte, diagnóstico, leitura, rascunho e configuração
> técnica, mas **não prova vínculo** com a prefeitura.

## Regra

Todo **ato institucional** exige uma membership **real**:
- persistida em `organization_members`;
- ativa;
- do mesmo órgão;
- com papel efetivo igual ou acima do piso do ato.

Atos institucionais são: emitir, aprovar, ratificar, publicar, formalizar, rescindir, registrar decisão governada e conceder privilégio no órgão.

A membership é relida da fonte autoritativa **a cada ato**. Não há cache, e o papel do contexto ou o `actorRole` informado pelo chamador nunca são usados.

| Peça | Onde |
|---|---|
| Invariante puro | `server/domain/institutionalAuthority.ts` (`evaluateInstitutionalAuthority`) |
| Guard central (fail-closed, recusa logada `institutional_authority_denied`) | `server/services/institutionalAuthorityService.ts` (`requireInstitutionalAuthority`) |
| Procedure de router | `institutionalProcedure(minRole)` = `orgRoleProcedure(minRole)` + autoridade real → `ctx.institutionalAuthority` (papel PERSISTIDO) |

## Comportamento em caso de recusa

- **Motivos de recusa:** membership ausente, membership inativa, outro órgão, registro sintético ou inválido, papel insuficiente, falha da consulta.
- **Resposta:** `FORBIDDEN` com o código estável `INSTITUTIONAL_AUTHORITY_REQUIRED`.
- **Momento:** a recusa acontece **antes** de qualquer escrita.
- **TOCTOU:** nos atos com transação (emissão oficial; aprovar, rejeitar ou arquivar documento em revisão; aceite de convite), a autoridade é relida **dentro** da transação com `FOR SHARE`. Nos demais atos a checagem é imediatamente anterior à escrita (janela residual curta, registrada).

## Atos protegidos (router e/ou serviço)

- **Processo Licitatório:**
  - `promoteOfficial`, com guard no **serviço** `promoteOfficialDocument`, que vale também para chamadas diretas;
  - `issueProcess`;
  - `processLifecycle.execute` com `CANCEL`, `ARCHIVE` ou `CORRECT_NUMBER` (descartar/resetar rascunho continua técnico).
- **Revisão documental:**
  - `documentReview.approve/reject/archive`, em `decideDocumentReview`, guard no serviço;
  - `documentWorkflowService` (legado, decisões com papel mínimo `manager` ou acima).
- **Modelos Institucionais** (`templatesProcedure`): `approve`, `publish`, `available`, `deprecate`, `bind`, `policy`, `evidence`, `govern` (decisões do certame, de orçamento e do perfil do órgão) e `review` (aceite de narrativa e reconhecimento de desvio).
- **Contratação Direta:** `ratify`, `publish`, `configureFlags` (decisão administrativa, ex.: dispensar parecer).
- **Contratos:**
  - `contractWorkspace.registerInForceContract`, `createAddendum`, `createApostille`;
  - `updateContract`, quando o **status** muda.
- **Rotas legadas ativas**, com membership real e o piso legado inalterado:
  - `contracts.create/update/amendments.create/apostilles.create/documents.create/documents.update/generation.generateRescission`;
  - `directContracts.update/documents.create/documents.update`.
- **Outras:**
  - `ingestion.promoteSession`;
  - `institutionalRequest.respond`;
  - `workspace.approveDecision`;
  - `operationRecord.registerMilestone/setPublication`.
- **CLI** `scripts/edital-pilot-harness.ts` (modo staging): passos de decisão exigem membership real `manager` ou acima.
- **Parecer Jurídico:** inalterado. O NEW-007 (`legalOpinionAuthorityService`) já exigia membership real e atribuição.

## Concessão de vínculo (anti-escalada)

- **Quem concede:** convidar, incluir, alterar papel e reativar exigem membership real `admin` ou acima de quem concede.
- **Autoconcessão:** ninguém concede vínculo a si mesmo (`SELF_GRANT_FORBIDDEN`).
- **Revalidação no aceite:** o emissor ainda precisa ser admin real (`INVITATION_GRANT_AUTHORITY_REQUIRED`), relido sob trava na transação do aceite; o aceitante nunca é o emissor; o aceite não sobrescreve o papel de quem já é membro ativo (`MEMBER_ALREADY_EXISTS`).
- **Autorrebaixamento:** continua possível (sujeito à proteção de último admin); só a autopromoção é recusada.
- **Exceção (bootstrap do onboarding):** convite `owner` criado pelo onboarding de tenant, só enquanto o órgão não tem nenhum membro ativo, e somente com **evidência verificável**:
  - quem emitiu o convite é admin de plataforma (`users.role = 'admin'`, o único que executa o onboarding);
  - existe o registro `tenant.onboarded` do mesmo órgão para o mesmo e-mail (gravado por `onboardTenant`).

  Convite `owner` legado ou gravado por outra via **não** é presumido bootstrap. No aceite, a regra é verificada **sob trava da organização** (`FOR UPDATE`) dentro da transação: dois aceites concorrentes de convites `owner` do mesmo órgão resultam em exatamente um titular (provado em `security02-bootstrap-owner-mysql-smoke`).
- **Continuam técnicos:** desativar e remover terceiros, listar membros e cancelar convites.

## Ledger eletrônico

`electronicAuthority` registra o papel **persistido**. O acesso técnico de plataforma, nas ações técnicas que ainda registram autoria (registrar ou derivar um modelo em DRAFT), recebe o rótulo explícito "Administrador técnico da plataforma (sem vínculo com o órgão)" e **nunca** o de "Titular do órgão".

A emissão oficial grava `emitterInstitutionalRole`, que é o papel persistido, relido na transação. No activity log (`logFromCtx`), ações do acesso técnico registram `actorRole = "platform_admin"`, nunca o `owner` sintético.

## Fora do escopo (decisão do Owner)

- **Lacunas de RBAC anteriores:** viewer nas rotas legadas de contratos e em `moduleLicensing`.
- **Gestão de contas na plataforma:** `adminRouter.promoteToAdmin`.
- **Identidade institucional** (`documentSettings.save`, `organizations.update`): configuração técnica, sem mudança.
- **Revisão histórica:** atos já registrados por admins de plataforma; somente leitura.
