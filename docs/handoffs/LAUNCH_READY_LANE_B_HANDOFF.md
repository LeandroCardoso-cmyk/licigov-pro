# LAUNCH_READY_LANE_B_HANDOFF — Engenharia, correções de produto e integração única

> Missão LICIGOV-LAUNCH-READY · Lane B · 26/11/2026 · integrador único.
> Entrada da convergência posterior (handoffs A e C + prompt de integração final). Não reiniciar o trabalho.

## 1. Baseline (revalidado)

| Item | Valor |
|---|---|
| main / produção | `559ab3e8dca3ec3ea69971e9425faafbfa0c8cb4` (= checkpoint) |
| staging | `084363f515fe20ff37d323539878ed0493af2fed` (= checkpoint) |
| Branch de trabalho | `launch-ready/product-remediation` (criada a partir de `staging`; nenhuma branch remota `launch-ready/*` pré-existente) |
| Working tree inicial | limpa; worktree única; nenhuma sessão concorrente na árvore |
| CI real | `.github/workflows/ci.yml` — PR para `staging` roda: typecheck + lint de não-regressão (arquivos alterados), `vitest run`, smokes MySQL 8 (`db:migrate:release` + `test:smoke:security` + smokes nomeados), build |
| Migrations | nenhuma alteração de schema nesta entrega (sem `db:generate`) |
| MySQL de teste | container `mysql:8` local descartável (`db:migrate:release` aplicado do zero) — nenhum ambiente real tocado |

## 2. Correções (IDs, causa raiz, arquivos)

| ID | Achado comprovado | Causa raiz | Correção | Arquivos |
|---|---|---|---|---|
| **SEC-04** (P0) | Qualquer membro do órgão (inclusive `viewer`) ativava/desativava módulos licenciados do próprio órgão, escolhendo plano, validade (null = sem expiração) e features — contornando o gate `isModuleLicensed` (`businessDomainRouter`) | Mutações em `tenantProcedure` puro, sem checagem de papel | Mutações exigem **admin de plataforma com tenant explícito** (X-Organization-Id, acesso auditado fail-closed pelo `resolveTenant`); recusa logada (`rbac/module_licensing_denied`); sem bypass por papel do órgão; leituras seguem no tenant. Nenhum consumidor cliente das mutações (sem quebra de UI) | `server/routers/moduleLicensingRouter.ts` |
| **SEC-04b** (P1, pré-existente, descoberto no teste real) | `activateModule` falhava SEMPRE em MySQL real (`Incorrect datetime value '…T…Z'` em `created_at DATETIME(3)`); reativação criava linha duplicada (id aleatório, sem unicidade org+domínio) e a leitura `limit 1` podia devolver a desativada | ISO 8601 gravado direto em DATETIME; upsert por PK aleatória | Conversão com `toDbDatetime` (helper canônico já usado nas correções de DATETIME); reativação atualiza a linha existente (org+domínio); serviço devolve o id persistido | `server/db/businessDomains.ts`, `server/services/moduleLicensingService.ts` |
| **PRD-02** (P1 comunicação) | Banners ETP/TR/Edital diziam "a emissão oficial exige revisão de um terceiro (SoD)"; o backend (#351) permite autoemissão por `manager` com membership real; a própria `OfficialPromotionSection` já dizia o contrário | Banners não atualizados em #351 | Aviso único `DraftReviewNotice` (rascunho → emissão interna por gestor; registra autoria/edição/emissão; **não** equivale a parecer, aprovação da autoridade, assinatura ou publicação). Edital: "antes da aprovação" → "antes da emissão". Mensagem de recusa de `processIssuance` e painel de importação alinhados. **Nenhuma regra de backend alterada** (segregação autor ≠ aprovador segue onde existe: parecer, aprovação/ratificação, publicação) | `client/src/components/procurement/DraftReviewNotice.tsx` (novo), `ETPWorkspace.tsx`, `TRWorkspace.tsx`, `EditalWorkspace.tsx`, `client/src/components/ingestion/DocumentImportPanel.tsx`, `server/domain/processIssuance.ts` |
| **PRD-01** | Landing: "Edital — Publica com segurança" (não há publicação externa; `publicationRecord` só registra status/data); "seguro no conteúdo" (absoluto); "Perguntou, a norma responde" | Copy de design | "Prepara a minuta a partir do processo"; "mais segurança jurídica" (comparativo); "orienta… a cuidar da forma e do conteúdo"; "Pergunte e receba a resposta com a fundamentação". Design system/estrutura preservados; nenhum número/cliente inventado | `client/src/pages/LandingPage.tsx` |
| **PRD-03** | Privacidade: "Método de login (OAuth)" (falso: e-mail/senha próprio); "servidores localizados no Brasil" (S3 padrão `us-east-1`, IA externa); "em conformidade com a LGPD" (absoluto); "criptografia em repouso" (não verificável); provedores omitidos; GA não mencionado. Termos: "você deve criar uma conta" (cadastro fechado); "Voltar" → `/configuracoes` para visitante público | Texto de jan/2025 sem revisão factual | Somente correções factuais nas páginas vigentes + **minuta institucional NÃO publicada** com campos `[PENDENTE]` | `client/src/pages/PrivacyPolicy.tsx`, `client/src/pages/TermsOfUse.tsx`, `docs/legal/PRIVACY_TERMS_LAUNCH_READY_DRAFT.md` (novo) |
| **PRD-04** | Login sempre oferecia "Criar conta" → `/register`, que o backend recusa (`ALLOW_PUBLIC_REGISTRATION=false` por padrão) só após o envio | Flag não exposta ao cliente | Query pública `auth.registrationStatus` (só o booleano já implícito na recusa de `register`); Login mostra "Criar conta" apenas se habilitado, senão orienta acesso por convite + "Solicitar demonstração"; `/register` fail-closed (sem confirmação do servidor não mostra formulário); links reais para Termos/Privacidade. Cadastro público **não** habilitado | `server/routers/authRouter.ts`, `client/src/pages/Login.tsx`, `client/src/pages/Register.tsx` |
| **PRD-05** | `NotificationBell` e `PublicationLogs` (vivo em `/admin/publication-logs`) navegavam para `/process/:id` (inexistente → NotFound); Dashboard executivo anunciava "credenciamento" em Contratação Direta (enum só `dispensa`/`inexigibilidade`) | Rotas legadas; copy | Navegação para `/processos` (o id é do cadastro legado `processes`, sem deep link no fluxo canônico); "Dispensa e inexigibilidade". `any` pré-existentes nesses arquivos tipados (gate de lint) | `client/src/components/NotificationBell.tsx`, `client/src/pages/PublicationLogs.tsx`, `client/src/pages/ExecutiveDashboard.tsx` |
| **COM-01** | Sucesso orientava "Realize o processo de empenho" e prometia "liberação em até 48h" (sem respaldo no servidor); sem proteção contra duplicidade; erro de validação aparecia como JSON técnico | Copy legado; insert simples | Mensagem sugerida pelo Owner + "manifestação de interesse… não gera obrigação contratual, decisão administrativa nem compromisso de aquisição"; sucesso só após persistência (já era `await`); **deduplicação**: mesma solicitação pendente (CNPJ em qualquer grafia + e-mail normalizado) em 24h devolve a existente, mesma resposta (não revela existência); erro legível (validação/rate limit). Preços, planos e fluxo administrativo **inalterados** | `client/src/pages/SolicitarProposta.tsx`, `server/routers/commercialRouter.ts`, `server/db/commercial.ts` |

## 3. Testes e gates (estado final da árvore)

Preenchido na seção 7 (evidências) com números reais.

## 4. Release e comercial — o que pode ser ofertado (sem ativar flags)

| Classe | Itens (evidência no código) |
|---|---|
| **Disponível** (núcleo, sem flag) | Licitações DFD → ETP → TR → minuta de Edital com emissão interna versionada e exportação; Gestão (Kanban, calendário, indicadores, relatórios); Central de Operações; consulta normativa; CATMAT/CATSER (`CATALOG_OFFICIAL_ENABLED` default true); convites, papéis e recuperação de senha |
| **Habilitável por órgão** (flag por organização, nunca global) | Modelos institucionais do Edital (`FF_INSTITUTIONAL_TEMPLATES_V1`); ingestão canônica (`CANONICAL_INGESTION_FLAG`); contrato direto shadow (`FF_DIRECT_CONTRACT_SHADOW`); módulos licenciados por domínio (`licensed_modules`, agora só via admin de plataforma) |
| **Em validação / parcial** | Contratação Direta (dispensa/inexigibilidade), Parecer Jurídico, Contratos e Aditivos (ativação de minuta pendente de definição jurídica), Documentos |
| **Planejado / não ofertar** | Credenciamento como contratação direta; publicação externa (PNCP/portais); exportação/exclusão LGPD por autoatendimento (desativadas); cadastro público |

A implantação do núcleo não depende dos itens planejados. Não usar percentuais de roadmap como readiness.

## 5. Pendências do Owner (decisões que o código não toma)

1. **Documentos legais:** preencher os `[PENDENTE]` da minuta (razão social, CNPJ, endereço, canal do titular/DPO, retenção, regiões efetivas S3/banco, provedores de IA em produção, GA/consentimento) e submeter a revisão jurídica antes de publicar.
2. **`/planos`** exibe "30 dias de teste grátis… Cancele quando quiser" (Stripe `trialDays: 30`) e `/solicitar-proposta` lista preços do seed (R$ 399/999/2.499) — condição comercial: manter, ocultar ou alinhar ao fluxo por proposta é decisão comercial (não alterado).
3. **Seed de planos em staging/produção:** `commercial.create` exige o plano no banco; sem seed, toda solicitação falha com "Plano não encontrado". Confirmar o seed nos ambientes (operação remota não autorizada nesta lane).
4. **Notificação interna de nova proposta** (e-mail ao comercial) inexistente — decidir canal.

## 6. Backlog P2 (não impeditivo)

- E-mail de convite diz sempre "Aceitar convite e criar minha conta", inclusive para quem já tem conta (`acceptExisting`).
- `Dashboard.tsx` navega para `/processo/:id` (redireciona a `/processos`, perde o id) — legado.
- Procedures administrativas de `commercialRouter` usam checagem inline de admin (equivalente a `adminProcedure`); padronizar.
- Reativação de módulo devolve `activationDate` novo (resposta), não o armazenado — cosmético.
- `history.back()` em Privacidade/Termos pode voltar a um referrer externo — cosmético.
- Deduplicação comercial não é atômica sob duas submissões simultâneas idênticas (mitigado por botão desabilitado + rate limit por IP); unicidade forte exigiria migration.
- `licensed_modules` sem índice único (org, domínio) — a correção é por aplicação; índice exige migration.
- `m8-emission-provenance-race-mysql-smoke` teve timeout de hook (10s) sob execução serial carregada; passa isolado — fora do delta.

## 6b. Auditoria independente (read-only, sobre o delta consolidado)

Resultado: **nenhum P0, nenhum P1**. Verificado: nenhum consumidor das mutações de licença (cliente, billing/Stripe,
seeds, onboarding) quebra; `platformLicensingProcedure` só passa após `resolveTenant` (header obrigatório + auditoria
fail-closed) e membro do órgão sempre tem `platformAdminAccess=false`; `registrationStatus` não vaza além do booleano;
Register/Login fail-closed; consulta de dedup parametrizada; `DraftReviewNotice` fiel a `documentPromotionService`;
alegações das páginas legais conferidas (backup diário `db-backup.yml`, bcrypt, GA condicional, S3 `us-east-1`,
`platformsRouter.publish` sem integração). P2 corrigidos na mesma execução: reenvio da proposta pendente agora
**atualiza** os dados informados (antes o complemento era descartado) e "cifrada por hash" → "hash, não reversível".
Demais P2 no backlog acima (unicidade (org, domínio) e dedup atômica exigem migration — fora do escopo autorizado).

## 7. Evidências, SHAs, PR e CI

(preenchido ao final da entrega)
