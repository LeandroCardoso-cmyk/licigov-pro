# LAUNCH_READY_FINAL_CLOSURE_HANDOFF — fechamento da operação e release candidate em staging

> Missão LICIGOV-LAUNCH-READY — FINAL CLOSURE & STAGING RELEASE · 26/11/2026 · integrador único.
> Continua `LAUNCH_READY_CONVERGENCE_HANDOFF.md`. Não autoriza lançamento comercial, merge em `main` nem produção.

## 1. Baseline reconfirmado
| Item | Valor |
|---|---|
| main | `559ab3e8dca3ec3ea69971e9425faafbfa0c8cb4` (inalterada) |
| staging (base do PR) | `084363f515fe20ff37d323539878ed0493af2fed` (inalterada até o merge) |
| PR | LeandroCardoso-cmyk/licigov-pro#357, aberto, `mergeable_state: clean`, sem escritor concorrente |
| HEAD de partida | `ec79e39` (5 gates verdes no run 45881231784) |
| Pipeline staging (Railway, leitura) | deploy automático da branch `staging` aguardando checks (`checkSuites: true`); predeploy canônico `pnpm db:release:predeploy`; último deploy `084363f` SUCCESS; região `asia-southeast1` |

## 2. Correções finais
| ID | Achado | Correção |
|---|---|---|
| DELTA-01 | 48 mutações de negócio em `tenantProcedure` puro aceitavam viewer (tarefas, departmentTasks, workspace, collaboration, editalParameters.save, platforms.updateProcessPlatform/publish, contracts.generation.*, directContracts create/quotations/generate/saveProgress, operationRecord create*) | `orgRoleProcedure("operator")` (elaboração, matriz NEW-006); `operationRecord.updateSettings` → manager (configuração institucional, como `configureFlags`). Mantidas sem piso: exportações, `consultCNPJ`, `checkDeadlines`/`checkExpirations` (consultas/verificações). Nenhuma competência nova criada |
| DELTA-02 | Exceções do órgão desativado | Exportação de conteúdo existente (`export*`) permitida (só renderiza, sem emissão/versão/status — conferido por auditoria); upload REST recusa (`ORGANIZATION_INACTIVE`) antes de consumir o corpo; aceites de convite (novo e conta existente) recusados — nenhum novo vínculo. `institutionalRagRouter`: stubs sem persistência/IA — sem bypass, controle preservado |
| DELTA-03 | Evidência direta da 0320 | Smoke dedicado `proposal-requests-0320-migration-mysql-smoke` (no `test:smoke:security`): instalação limpa sob advisory lock, ledger estável no replay, proposta sem plano persiste; upgrade 0319→0320 com linha legada preservada byte a byte; SOMENTE `planSlug/planName/planPrice` mudam e SOMENTE em nulabilidade (tipo/default/extra/índices e demais tabelas idênticos). Os filtros dos smokes 0316–0318 excluem exatamente essas 3 colunas de `proposal_requests` (mesmo precedente da 0319) |
| DELTA-04 | Alinhamento documental | `PRODUCT_NORTH_STAR.md` (decisão 13, nota em Publicações, "O Que NÃO Fazemos", Future Evolution), `roadmap/PRODUCT_ROADMAP.md` (nota de topo, P2, Sprints 7/8 — histórico preservado, percentuais inalterados), `CLAUDE.md` (Billing legado, "O que NÃO É"), `PAINEL_ADMIN_PROPOSTAS.md` (histórico superado), documento de decisão atualizado |
| DELTA-05 | Reconciliação de segurança | `docs/security/incident-2026-10/AUDIT_REPORT.md` §13: informações DECLARADAS pelo Owner, com a natureza de cada evidência; AWS = risco aceito (≠ prova de revogação); Google Workspace 2FA pendente; S3 e proxy TCP não comprovados; org 1 protegida. Sem SECURITY_READY, incidente não encerrado |

## 3. Testes e auditoria do delta
- Typecheck, lint dos alterados: PASS. `pnpm test` (modo CI): **496 arquivos / 9.030 testes PASS**.
- Smokes MySQL afetados + `test:smoke:security` (64 arquivos): 63 PASS e 1 ajuste de fixture (outsider `viewer` agora é recusado pelo piso antes do vínculo — intenção do teste preservada com outsider `operator` e nova prova de recusa IDÊNTICA para processo existente/inexistente); reexecução: PASS (40 testes nos arquivos afetados).
- Smoke 0320: PASS (2/2).
- Auditoria independente read-only do delta: **sem P0/P1**. P2 tratados: teste de exportação agora exige conclusão; alerta no código sobre o critério por nome `export*`. P2 no backlog: comentários em `departmentTasks` agora exigem operator (decisão de produto a confirmar); Kanban mostra arrastar a viewer (UX); `org && ativo === false` tolera ausência da linha (que falha em outras checagens).

## 4. Pendências do Owner
1. Preencher `COMMERCIAL_NOTIFICATION_EMAIL` (staging/produção).
2. Minuta legal: 10 decisões fechadas + aprovação jurídica (não publicada).
3. Confirmar: viewer pode comentar tarefas do departamento? (hoje: não — operator+).
4. Rota administrativa auditada para desativar/reativar órgão (hoje só por SQL; nenhuma desativação remota feita).
5. Segurança: atestação sanitizada da Lane A para o §10/§13 do AUDIT_REPORT; qualificar risco AWS; confirmar 2FA do Google Workspace; comprovar isolamento do bucket S3 staging × produção e proteção do proxy TCP.
6. Merge em `main`/produção: autorização separada (não concedida).

## 5. Handoff para homologação (Lane C) — staging
Pré-condições: deploy de staging do squash do #357 com SUCCESS, 0320 aplicada pelo predeploy; tenant **sintético identificado**
(nunca a org 1); IA real somente com credencial autorizada; revisão humana real. Jornadas: onboarding institucional (criar órgão,
convite, aceite, convites por papel; retry ⇒ `pending_invitation`); DFD → Pesquisa de preços → Itens → ETP → TR → Edital padrão;
modelos institucionais só se a flag do órgão sintético for habilitada pelo Owner; emissão interna por manager; exportação DOCX/PDF;
contratos vigentes e aditivos (manager; operator não altera instrumento ativo; viewer só lê); calendário e Centro de Operações;
comercial: `/solicitar-proposta` sem planos, `/planos` redireciona. Evidência automatizada = `MECHANISM_ONLY — HUMAN_REVIEW_NOT_VERIFIED`;
etapas humanas = `BLOCKED_HUMAN_REVIEW` até pessoa real agir.

## 6. Merge, deploy e classificação
Registrados no relatório final da sessão (SHA do squash, deploy Railway correspondente, predeploy/ledger da 0320, health e smoke
não mutável), pois ocorrem após este commit.
