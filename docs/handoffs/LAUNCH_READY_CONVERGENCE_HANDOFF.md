# LAUNCH_READY_CONVERGENCE_HANDOFF — Correções finais, modelo comercial institucional e release candidate

> Missão LICIGOV-LAUNCH-READY — convergência executiva (integrador único) · 26/11/2026.
> Continua `docs/handoffs/LAUNCH_READY_LANE_B_HANDOFF.md`. Decisões estratégicas: `docs/architecture/LAUNCH_READY_COMMERCIAL_MODEL_DECISION.md`.
> **Nenhuma classificação técnica abaixo é autorização de lançamento comercial.**

## A. Baseline e HEAD

| Item | Valor |
|---|---|
| main / produção | `559ab3e8dca3ec3ea69971e9425faafbfa0c8cb4` (inalterada) |
| staging | `084363f515fe20ff37d323539878ed0493af2fed` (inalterada; sem merge) |
| PR | LeandroCardoso-cmyk/licigov-pro#357 → `staging`, aberto, sem escritor concorrente |
| Branch | `launch-ready/product-remediation` — início da convergência em `0f3b19f` |
| Commits da convergência | `5c9d92a` (código), `ec7b47a` (Graphify, separado), + commit final de correções P2/handoff e seu commit Graphify |
| Banco de teste | MySQL 8 em container local descartável; recriado do zero para os gates; nenhum ambiente remoto, nenhuma org real (org 1 nunca usada) |

## B. Matriz consolidada de achados A/B/C

| ID | Origem | Achado | Severidade | Estado |
|---|---|---|---|---|
| SEC-04 / LA-01 | B/A | Qualquer membro licenciava módulos do próprio órgão | P0 | Corrigido (Lane B) + LR-04 |
| D-1 | C | Órgão gravado sem convite após falha; retry `invitationId: 0` sem recuperação | P1 | **Corrigido (LR-01)** |
| D-2 | C | `commercial.create` exige plano (falha em banco recém-migrado) | P1 | **Corrigido (LR-02, migration 0320)** |
| D-3 | C | `CommercialManagement.tsx` enviava `userId: proposalId` → assinatura para usuário arbitrário | **P0 confirmado** | **Corrigido (LR-03)** |
| LA-04 | A | 13 atos com piso `viewer` (incl. criação de contrato) | P0/P1 | **Corrigido (LR-05)** + lacuna remanescente (status atual) corrigida após auditoria |
| LA-03 | A | Organização desativada continua operando | P1 | **Corrigido (LR-06)** — mutações via tenant; somente leitura |
| COM/PRD | B | Comunicação, cadastro, proposta, privacidade | P1 | Lane B + LR-07/LR-08/LR-09 |
| SECURITY_BLOCKED | A | Rotação pós-incidente não comprovada (JWT, Gemini, AWS, Brevo, senha admin), bucket possivelmente compartilhado, proxy TCP público, revisão de consumo | Crítico operacional | **Pendente — fora da engenharia (ver K)** |

## C. Correções LR-01 a LR-09 (causa raiz → correção)

| ID | Causa raiz | Correção | Arquivos principais |
|---|---|---|---|
| LR-01 | `onboardTenant` sem transação externa: INSERT do órgão em autocommit e convite em chamada separada; retry por slug+nome+cnpj retornava literal `invitationId: 0`; a evidência (`tenant.onboarded`) era gravada DEPOIS do convite, e `logActivity` engole erros → convite "morto" possível | Evidência ANTES do convite e confirmada por leitura; retry inspeciona o estado: órgão com qualquer vínculo (ativo ou não) ou convite aceito ⇒ `has_members` (nenhum owner novo); convite owner pendente válido (evidência + e-mail não falho) ⇒ `pending_invitation` (o mesmo id); órgão órfão ⇒ `recovered` (evidência + convite reemitidos, outros convites owner pendentes supersedidos, `tenant.onboarding_recovered` auditado). Só admin de plataforma (`adminProcedure`). Envio de e-mail continua assíncrono pelo outbox e não decide a persistência | `server/services/tenantOnboardingService.ts`, `server/services/invitationService.ts`, `client/src/pages/AdminOrganizacoes.tsx` |
| LR-02 | `proposal_requests.planSlug/planName/planPrice NOT NULL` + `getSubscriptionPlanBySlug` obrigatório | Migration **0320** (aditiva: só relaxa NOT NULL, nenhuma linha alterada); `create` não consulta planos/preços; preferência informada opcional; formulário sem planos/preços de seed | `drizzle/schema.ts`, `drizzle/0320_proposal_requests_plan_optional.sql`, `server/routers/commercialRouter.ts`, `client/src/pages/SolicitarProposta.tsx` |
| LR-03 | Tela passava `userId: proposalId`; servidor aceitava qualquer `userId` e criava assinatura de 1 ano | `commercial.activateSubscription` desativado (`LEGACY_ENDPOINT_DISABLED`, nenhuma escrita); ação removida da tela; procedures comerciais em `adminProcedure`; concessão de acesso indicada por organização (onboarding + licença); contagem quebrada do painel Admin (`proposals` inexistente) corrigida | `commercialRouter.ts`, `CommercialManagement.tsx`, `CommercialProposalsTable.tsx`, `Admin.tsx` |
| LR-04 | Só a auditoria de ACESSO existia; validade livre; leitura `limit 1` sem ordem | Auditoria persistida de CADA mutação antes de mutar (fail-closed); validade = data de calendário real e futura (≤ 30 chars); leitura determinística (ativa e mais recente). **Índice único (org, domínio): avaliado e NÃO impeditivo** — mutação restrita a admin de plataforma, reativação atualiza a linha existente, ativação em MySQL real falhava antes da Lane B (logo, sem linhas legadas prováveis em produção); permanece no backlog | `moduleLicensingRouter.ts`, `server/db/businessDomains.ts` |
| LR-05 | Rotas legadas em `institutionalProcedure("viewer")` | Matriz NEW-006: aditivo, apostilamento, rescisão e `approveDecision` → manager; create/update/documentos → operator com piso manager CONDICIONAL sobre o papel PERSISTIDO quando o estado atual OU pedido sai de rascunho (inclui rebaixar status e alterar valor/vigência de contrato ativo); `registerMilestone/setPublication` → operator (registro declarado de ato externo, como `complete/reopen`). Nenhum ato ficou BLOCKED por falta de política: a matriz NEW-006 vigente cobriu todos | `contractsRouter.ts`, `directContractsRouter.ts`, `workspaceRouter.ts`, `operationRecordRouter.ts`, `server/_core/trpc.ts`, `server/db/contracts.ts`, `server/db/directContracts.ts` |
| LR-06 | Resolução de tenant ignorava `organizations.ativo`; não há rota que desative órgão (só SQL) | Estado do órgão lido na MESMA consulta da membership (subconsulta qualificada, sem chamada extra); mutação de membro em órgão desativado ⇒ `FORBIDDEN ORGANIZATION_INACTIVE`; consultas preservadas; admin de plataforma (técnico, auditado) não bloqueado. Sem suspensão automática, sem apagar/ocultar documentos | `server/services/tenantService.ts`, `server/_core/trpc.ts` |
| LR-07 | Vitrine `/planos` com checkout por usuário, teste grátis 30 dias, "SLA 98%" e preços do seed | `/planos` → `/solicitar-proposta`; `Plans.tsx` vira redirect; `billing.createCheckoutSession` desativado (Stripe preservado); landing: "Apoio à classificação CATMAT/CATSER", "Modelos institucionais (habilitáveis por órgão)", "Consulta normativa com fontes governadas", "Contratações diretas (dispensa e inexigibilidade)" | `App.tsx`, `Plans.tsx`, `billingRouter.ts`, `LandingPage.tsx` |
| LR-08 | Nenhum aviso de nova solicitação | Outbox existente (Brevo/console/fake): `commercial_proposal_received`, idempotente por solicitação, enfileirado DEPOIS da persistência, falha registrada sem afetar a resposta, sem destinatário ⇒ nenhum aviso; conteúdo mínimo (órgão, cidade/UF, link restrito; nenhum dado pessoal do responsável). **Variável a preencher pelo Owner: `COMMERCIAL_NOTIFICATION_EMAIL`** | `commercialRouter.ts`, `server/services/email/*`, `server/config/email.ts`, `.env.example` |
| LR-09 | Minuta sem regiões/papéis/lista fechada de pendências | Minuta ampliada (não publicada): região NÃO comprovada (relato asia-southeast1 × padrão S3 us-east-1), tabela controlador/operador por finalidade (hipótese), provedores, IA, GA, retenção, direitos, lista fechada de 10 decisões | `docs/legal/PRIVACY_TERMS_LAUNCH_READY_DRAFT.md` |

## D. Não necessárias ou já realizadas
- SEC-04 (Lane B) — conferido: admin de plataforma, tenant explícito, auditoria de acesso fail-closed, sem autoativação, reativação idempotente; LR-04 acrescentou auditoria por mutação e validade.
- Exclusão de código/tabelas Stripe — não feita (decisão do Owner).
- Notificação/ativação automática de acesso por empenho — não implementada (fora do modelo).

## E. Schema / migrations
- **0320_proposal_requests_plan_optional** (aditiva, não destrutiva, compatível com o build anterior). Testada: aplicação do zero (`db:migrate:release` em banco recriado), clean install/upgrade/replay (`reconciliation-mysql-smoke`), contas de menor privilégio, guardas de snapshot (só `proposal_requests` muda; só 3 colunas perdem NOT NULL). **Nenhuma migration remota executada.**

## F. Testes reais (estado final, local)
| Gate | Resultado |
|---|---|
| `pnpm check` | PASS |
| ESLint `--max-warnings 0` nos arquivos alterados vs `staging` | PASS (any pré-existentes tipados nos arquivos tocados) |
| `pnpm build` | PASS |
| `pnpm test` (modo CI, sem banco) | PASS — 496 arquivos / 9.027 testes (139 arquivos MySQL pulados por desenho) |
| Job "Smoke MySQL + Isolamento" reproduzido (60 passos, banco recriado do zero) | PASS — 60/60 (antes das correções P2) |
| Smokes MySQL afetados após correções P2 (27 arquivos) | PASS — 262 testes; revalidação final 4 arquivos / 57 testes |
| Novo `launch-ready-convergence-mysql-smoke` (no `test:smoke:security`) | PASS — cobre falha intermediária/órfão, convite morto, falha de e-mail, concorrência, has_members, permissões; proposta sem plano; aviso; IDs coincidentes/divergentes/replay; papéis; tenant cruzado; órgão desativado |
| Graphify | atualizado com a toolchain fixada, em commit SEPARADO do código |

## G. Auditoria independente
Sem P0/P1. P2 corrigidos nesta execução: (1) operator rebaixava status/alterava valor de contrato ativo e documentos `final` (estado ATUAL passou a contar); (2) reenvio público sobrescrevia dados da proposta (agora só acrescenta observações); (3) subconsulta de `ativo` dependia de resolução implícita de coluna (agora qualificada); (4) validade aceitava datas inexistentes. Backlog: itens H abaixo.

## H. Backlog P2 (não impeditivo)
- Índice único `licensed_modules(organization_id, business_domain_code)` (exige dedup e migration).
- LR-06: rotas fora do `tenantProcedure` (`institutionalRagRouter` em `protectedProcedure`, `invitations.acceptExisting`, uploads REST) não verificam órgão desativado; exportações (mutations "de leitura") ficam bloqueadas em órgão desativado.
- Mutações de negócio em `tenantProcedure` puro fora dos 13 atos (tarefas, `departmentTasks`, `workspace.create*`, `collaboration`, `editalParameters.save`, `platformsRouter.publish/updateProcessPlatform`, `contracts.generation.*`, `directContracts.create/quotations/generate`, `operationRecord.create*`) aceitam viewer — aplicar NEW-006 em pacote próprio.
- UI: botões de aditivo/apostilamento/rescisão visíveis a operator (recebem FORBIDDEN) — ocultar por papel.
- LR-01: retry com e-mail diferente supersede o convite do e-mail anterior sem aviso explícito; recuperação também vale para órgão vazio criado por `organizations.adminCreate`.
- LR-08: sem banco, o outbox retorna silenciosamente e o aviso é reportado como "enqueued"; `adminUrl` relativo se `APP_BASE_URL` vazio (dev).
- LR-04: auditoria é gravada antes da mutação (pode registrar tentativa que falhou depois) — aceito por ser fail-closed.
- `PricingPlans.tsx` e `proposalGenerator*` são código morto.

## I. PR #357
Atualizado com a convergência (descrição reescrita). Merge **não** autorizado.

## J. Pendências exclusivamente do Owner
1. Preencher `COMMERCIAL_NOTIFICATION_EMAIL` (staging/produção) com a caixa comercial.
2. Lista fechada de 10 decisões da minuta legal (razão social, CNPJ, endereço, canal/DPO, regiões efetivas, papéis, IA, retenção, GA/consentimento, procedimento de direitos) + aprovação jurídica antes de publicar.
3. Confirmar a semântica de "organização desativada" (hoje: somente leitura para membros) e se haverá rota administrativa auditada para desativar/reativar (não existe; só SQL).
4. Alinhar roadmap/Constituição às decisões (seção 3 do documento de decisão).
5. Merge do PR #357 em `staging` (autorização separada).

## K. Pendências de infraestrutura (Lane A — SECURITY_BLOCKED mantido)
Comprovar rotação pós-incidente de JWT_SECRET, chaves Gemini, AWS, Brevo e senha administrativa (o JWT antigo suspeito não deve ser aceito; preservação forense ≠ uso operacional); revisar consumo dos provedores; separar bucket staging × produção; avaliar proxy TCP público do MySQL; política de retenção de backup (14 dias no GitHub); confirmar regiões. Comunicação ao controlador/avaliação jurídica do incidente: trilha separada da engenharia. **Nada disso foi alterado nesta missão.**

## L. Plano objetivo de homologação da release candidate (staging isolado, tenant sintético identificado)
Pré-condições: merge autorizado do #357 em staging; `db:migrate:release` pelo predeploy (0320); `COMMERCIAL_NOTIFICATION_EMAIL` definido; Brevo de staging; nenhuma credencial suspeita em uso (K).
1. **Onboarding institucional:** admin de plataforma cria órgão sintético → convite owner → aceite → convite de servidores (operator/manager/viewer) → primeiro acesso; repetir a criação (deve devolver `pending_invitation`).
2. **DFD → Pesquisa de preços → Itens → ETP → TR → Edital padrão** (IA real só com credencial autorizada; revisão humana real; sem `[REVISAR]` substituído por agente).
3. **Modelos institucionais** (somente se a flag por órgão for habilitada pelo Owner para o órgão sintético).
4. **Emissão interna** por manager; **exportação** DOCX/PDF.
5. **Contratos vigentes e aditivos** (manager), verificação de que operator não altera instrumento ativo.
6. **Calendário e Centro de Operações.**
7. **Comercial:** `/solicitar-proposta` em banco migrado sem planos; aviso interno recebido; `/planos` redireciona.
Evidências produzidas por automação são `MECHANISM_ONLY — HUMAN_REVIEW_NOT_VERIFIED`; etapas humanas ficam `BLOCKED_HUMAN_REVIEW` até pessoa real agir.

## M. Decisões estratégicas e documentos a alinhar
`docs/architecture/LAUNCH_READY_COMMERCIAL_MODEL_DECISION.md` (registrado). A alinhar: roadmap P2/Sprint 7/Sprint 8, nota da Constituição sobre "PNCP é padrão" (registro declarado), CLAUDE.md (Stripe legado).

## N. Atualização sanitizada para o Maestro (somente o verificado por teste)
- Criação de órgão pelo admin de plataforma com convite do 1º administrador é consistente e recuperável após falha.
- Solicitação de demonstração/proposta funciona sem planos cadastrados, sem preço e sem obrigação; a equipe comercial pode ser avisada por e-mail interno configurável.
- Checkout por usuário e ativação de assinatura por proposta estão desligados; acesso é concedido por organização.
- Licenças de módulo só pelo admin de plataforma, com auditoria por operação.
- Contratos legados: viewer não altera; operator elabora rascunhos; manager pratica atos sobre instrumentos ativos.
- Órgão desativado fica somente leitura para seus membros.

## O. Estado de readiness
**CONDITIONAL_READY** (técnico): RC com todos os gates locais verdes e CI a confirmar no HEAD final. **Não é GO de lançamento**: permanecem (1) SECURITY_BLOCKED operacional (K); (2) documentos legais não aprovados (J.2); (3) homologação integrada em staging com revisão humana real (L) não realizada.
