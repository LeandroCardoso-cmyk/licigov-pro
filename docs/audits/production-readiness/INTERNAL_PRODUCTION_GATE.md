# Gate de Produção Interna
### LiciGov Pro · Piloto Moreira Sales · 2026-07-22

**Pergunta que este gate responde:**
> O LiciGov Pro pode ser utilizado internamente pela Prefeitura de Moreira Sales com risco
> institucional aceitável?

**Resposta atual (pós-PR A + hardening Gemini/retrieval + AI-015 fail-closed): NÃO — 4 dos 12 itens
do Gate Obrigatório ainda não estão em `PASS`** (1 FAIL + 3 PARTIAL). A PR A (Bloco A) fechou
G1/G2/G3/G6. A série de hardening do runtime Gemini + recuperação jurídica + o fecho do AI-015
(fail-closed do provider) fecharam **G12**; a confirmação de `ADMIN_PASSWORD` no ambiente fechou
**G4**; o SEC-022 (TTL 24h configurável) sustenta **G9** (ver adendo). Restam G5 (segredos), G8
(Bloco B), G11 (backup) e G7 (Bloco D — CI). Status por item:
**PASS** · **FAIL** · **PARTIAL** · **NOT_VERIFIED** · **N/A**.

> **Severidade ≠ decisão de go-live.** A severidade (P0/P1/P2/P3) dos achados classifica impacto
> técnico; é **este gate** que decide o go-live. Um achado P1/P2 pode bloquear a produção interna
> se estiver por trás de um item de gate não-`PASS`. A severidade não substitui o gate.

---

## Gate Obrigatório

> **Regra de bloqueio.** Para autorizar a produção interna, **todo item aplicável do Gate
> Obrigatório deve estar em `PASS`**. Os estados `FAIL`, `PARTIAL` e `NOT_VERIFIED` continuam
> bloqueando o go-live — não basta eliminar apenas os itens em `FAIL`. Um item só deixa de
> bloquear se for formalmente classificado como `N/A`, com justificativa documentada. Após a PR A,
> os itens `PARTIAL` remanescentes (G4/G5/G8/G11) permanecem bloqueantes enquanto não forem `PASS`.

| # | Item | Status | Evidência / condição de PASS |
|---|---|:---:|---|
| G1 | Nenhum IDOR no core (processos/tarefas/documentos/comentários) | **PASS** | RC-SEC-PR-A: TENANT-001/002/008 corrigidos (tenantProcedure + *ForOrganization); freeze + MySQL-real |
| G2 | Nenhum endpoint institucional público sem auth | **PASS** | RC-SEC-PR-A: AUTH-003 corrigido (deployment/stability → adminProcedure); freeze |
| G3 | Nenhuma escalação de privilégio | **PASS** | RC-SEC-PR-A: RBAC-004 corrigido (onboarding orgRoleProcedure, escopo global só admin plataforma) |
| G4 | Sem credencial default em produção | **PASS** | CONFIG-005: código exige `ADMIN_PASSWORD` (mínimo 8 chars) em staging/production, sem default — boot falha se ausente; `ADMIN_PASSWORD` **configurada e validada** no ambiente (confirmação operacional) |
| G5 | Segredos fora do repositório e rotacionados | **PARTIAL** | SEC-018: `.env` removido do índice; PASS = rotação dos segredos (runbook, OPERATOR_ACTION_REQUIRED) |
| G6 | Registro não permite entrada indevida no tenant do órgão | **PASS** | RC-SEC-PR-A: SEC-017 corrigido (fallback org 1 removido; registro fail-closed) |
| G7 | CI comprova que o projeto compila e o isolamento não regrediu | **FAIL** | DEPLOY-019/049; PASS = build+typecheck+smokes de isolamento no gate |
| G8 | Fluxo principal navegável e sem telas de debug/duplicadas | **PARTIAL** | UI-054, LEGACY-013; PASS = rotas de teste e legadas fora da navegação |
| G9 | Login/sessão/logout funcionais | **PASS** | JWT httpOnly ok; SEC-022 corrigido — TTL de sessão padrão **24h, configurável** via `SESSION_TTL_HOURS` (1–720h; `SESSION_TTL_MS` em `config/auth.ts`, aplicado ao JWT em `_core/sdk.ts`). O default de 1 ano foi removido |
| G10 | Suíte de testes verde no snapshot | **PASS** | 3924 passed / 92 skipped / 0 falhas; typecheck 0 erros; build ok (snapshot pós AI-015 fail-closed) |
| G11 | Backup e restauração disponíveis | **PARTIAL** | DEPLOY-051; backup manual + DR documentado; **restore nunca testado**. PASS = backup agendado/automatizado + retenção definida + ≥1 teste de restauração bem-sucedido registrado |
| G12 | IA nunca serve conteúdo mock como oficial sem sinalizar | **PASS** | AI-015 resolvido em duas frentes: (a) `thinkingConfig` deixou de derrubar a chamada real e `GEMINI_API_KEY` foi rotacionada e **validada em staging**; (b) **fail-closed do provider** — o fallback implícito para `MockAIProvider` é PROIBIDO em staging/production (`selectProvider` lança `NoRealAIProviderError`); sem provider real a consulta falha de forma controlada e NÃO persiste resposta oficial (`failed`); erro de runtime do Gemini não cai no mock; mock só em dev/test com `AI_ALLOW_MOCK_FALLBACK=true` (default false) e, quando usado, é marcado (`provider=mock`) e NUNCA classificado como oficial/"Fundamentada". Selos de suficiência + evidência-por-intenção complementam. Testes: `ai-015-mock-fallback-policy.test.ts`. Ver adendo |

**Resultado do Gate Obrigatório (pós-PR A + hardening Gemini/retrieval + AI-015 fail-closed): 8 PASS · 1 FAIL · 3 PARTIAL · 0 NOT_VERIFIED · 0 N/A (total 12).**
PASS: G1, G2, G3, G4, G6, G9, G10, G12 · FAIL: G7 · PARTIAL: G5, G8, G11.
Pela regra de bloqueio acima, enquanto qualquer item aplicável não estiver em `PASS` — incluindo
os `PARTIAL` (G5/G8/G11) — o go-live **não** é autorizado. A PR A moveu G1/G2/G3/G6 para PASS;
a série Gemini/retrieval + AI-015 fail-closed fechou **G12**; a confirmação de `ADMIN_PASSWORD` no
ambiente fechou **G4**; e o SEC-022 (TTL de sessão 24h configurável) sustenta **G9**. Restam: **G5**
(rotação de segredos — reconfirmar conclusão do runbook), **G8** (Bloco B — rotas de teste/legadas
fora da navegação), **G11** (backup agendado + teste de restauração) e **G7** (Bloco D — gate de CI).

---

## Gate por Módulo (podem ficar ocultos/desabilitados no piloto)

| Módulo | Decisão para o piloto | Justificativa |
|---|---|---|
| Contratação Direta, Parecer, Contratos, Tirar Dúvidas, Central de Operações | **LIBERAR** | Canônicos, tenant-safe, utilizáveis (ressalvas P1/P2) |
| Processos + DFD/ETP/TR | **LIBERAR APÓS BLOCO A+B** | Core do MVP; bloqueado por IDOR até correção |
| CATMAT/CATSER | **LIBERAR COM REVISÃO HUMANA** | Sugestão IA pode alucinar código (DOC-016) |
| Importação de itens | **LIBERAR PARCIAL (só Excel)** | Word/PDF/pipeline semântico órfãos |
| Gestão/Tarefas | **OCULTAR ATÉ BLOCO A** | IDOR (TENANT-002) |
| Aprovação/Workflow | **OCULTAR** | Em memória, aprovador forjável (AUDIT-020) |
| Deploy/Estabilidade | **OCULTAR/PROTEGER** | Públicos (AUTH-003) |
| RAG institucional, Copilots, Agentes, Governança IA | **OCULTAR** | Órfãos do frontend, fora do escopo do piloto |
| Billing/Comercial | **OCULTAR** | Fora do escopo do Departamento de Licitações |
| Rotas legadas (`/direct-contracts`, `/contracts`, `/parecer-juridico`, `/modulos`) | **OCULTAR** | Duplicam os canônicos |
| Páginas de teste (`/test*`) | **REMOVER** | Debug em produção |

---

## Gate Pós-Produção (aceitável corrigir durante o piloto)

- Governança cognitiva da IA (Bloco C): rastreabilidade legada, idempotência ampla, aprovações persistidas.
- Observabilidade: Sentry/APM, correlation ID ponta a ponta, `structuredLog` uniforme (OBS-044/045).
- Transações nas operações não-críticas de sequência (DATA-039); FKs e índices (DATA-041/078).
- Limpeza de legado, dead code, deps não usadas, `.manus/*` (P3).
- Cobertura de testes de Gestão/billing (TEST-053).
- Backup agendado e teste de restore (DEPLOY-051).
- Reconciliação schema↔migrations (DATA-040/042).

---

## Teste de Realidade do Piloto (25 perguntas)

| # | Pergunta | Resposta | Evidência |
|---|---|:---:|---|
| 1 | Servidor consegue entrar? | **Sim** | Login JWT funcional |
| 2 | Tenant de Moreira Sales resolvido corretamente? | **Parcial** | Single-org auto-resolve; fallback org 1 é risco (SEC-017) |
| 3 | Usuário chega ao Centro de Operações? | **Sim** | `/dashboard` → CentroOperacoes |
| 4 | Centro de Operações usa módulos canônicos? | **Sim** | departmentOperation.* |
| 5 | Dashboard ainda mostra funcionalidades legadas? | **Parcial** | Rotas legadas montadas mas não linkadas; menu Processos é legado |
| 6 | Os cards realmente funcionam? | **Parcial** | Dados reais; botão de relatório e cliques mortos (DASH-021) |
| 7 | Consegue criar um processo? | **Sim** | `/novo-processo` (com IDOR no backend — TENANT-001) |
| 8 | Consegue elaborar DFD? | **Sim** | IA + aba DFD |
| 9 | Consegue elaborar ETP? | **Sim** | Aba ETP |
| 10 | Consegue elaborar TR? | **Sim** | Aba TR |
| 11 | Consegue importar itens? | **Parcial** | Só Excel |
| 12 | Consegue usar CATMAT/CATSER? | **Sim** | Busca real; sugestão IA com risco (DOC-016) |
| 13 | Consegue revisar e versionar? | **Sim** | Histórico + restore |
| 14 | Consegue exportar? | **Sim** | DOCX/PDF reais |
| 15 | Consegue usar Tirar Dúvidas? | **Sim** | Corpus real + citações; Gemini real + recuperação jurídica corrigida, **validado em staging** (arts. 72–75; Lei Municipal 769); selos de suficiência + Source Scope Router (G12 PASS) |
| 16 | Consegue gerar parecer jurídico? | **Sim** | Fluxo canônico completo |
| 17 | Consegue criar contratação direta? | **Sim** | Wizard canônico tenant-safe |
| 18 | Consegue gerar contrato e aditivo? | **Sim** | `/contratos` + OfficialDocumentPanel |
| 19 | Consegue acompanhar na Central de Controle? | **Parcial** | Não vê processos do fluxo legado (LEGACY-011) |
| 20 | Existe trilha de auditoria? | **Sim** | `activity_logs` (ator+org+entidade+IP); sem before/after |
| 21 | Existe risco de acessar dados de outro órgão? | **Sim** | TENANT-001/002/006 (mitigado em single-tenant, mas real) |
| 22 | Existe risco de perder dados? | **Parcial** | Sem transações (DATA-012); backup manual (DEPLOY-051) |
| 23 | Existe rollback? | **Parcial** | Manual via Railway/restore; migrations forward-only |
| 24 | Observabilidade suficiente para diagnosticar falhas? | **Parcial** | Logs + activity_logs; sem Sentry/APM, sem /health (OBS-043/044) |
| 25 | Pode ir a produção interna ocultando módulos incompletos? | **Sim, após Bloco A+B+D** | Módulos de Fase 5 sustentam; core exige correção antes |

---

## Adendo — Hardening do runtime Gemini + recuperação jurídica (G12), validado em staging

Série de correções `15ccc9e`..`d688680` no fluxo "Tirar Dúvidas" (Business Domain de consulta
normativa). **Validada manualmente em staging com sucesso**, incluindo a Lei Municipal nº 769/2021 de
Moreira Sales. Relatórios detalhados em `docs/ai/RAG_QUALITY_00{1,2,3}_REPORT.md`,
`docs/ai/SOURCE_SCOPE_ROUTER_001_REPORT.md` e a ação operacional em
`docs/ops/MUNICIPAL_CORPUS_STAGING_ACTION.md`.

| Correção | Evidência |
|---|---|
| Payload Gemini + `APP_ENV` | `thinkingConfig` deixou de ser enviado a aliases móveis (`gemini-flash-latest`) que o rejeitavam com `400 INVALID_ARGUMENT`; `APP_ENV=production` removido do script `start` (staging reporta `staging`). O mock silencioso (AI-015) mascarava o payload inválido — corrigido |
| Recuperação jurídica | BM25-lite com normalização de comprimento + boost de título/seção + vizinhança estrutural por capítulo; pergunta geral sobre contratação direta recupera arts. 72–75 (antes trazia arts. 6º/9º/14 irrelevantes) |
| Deduplicação e relevância | Artigos repetidos no texto-fonte (Art. 191, 3× por histórico de MP) deduplicados mantendo a redação vigente; penalização de container genérico (Disposições Transitórias/Finais) quando há capítulo temático concorrente |
| Truncamento e retry | `finishReason` (antes descartado) instrumentado; orçamento de saída de `LEGAL_ANALYSIS` configurável (1500→3000); retry único em `MAX_TOKENS` reusando o mesmo `ContextPackage`/`correlationId`, sem duplicar histórico |
| Source Scope Router | Roteamento determinístico de escopo antes do retrieval: diploma citado → 1ª busca restrita; ampliação no máximo 1× (pedido/remissão/insuficiência); auditável e replay-safe |
| Aplicabilidade institucional | Classificação federal geral / executivo federal / municipal / jurisprudência (+ flags SRP-específica, federal-only); SRP não entra em pergunta geral sem relação; ressalva de aplicabilidade para norma federal/SRP em contexto municipal; isolamento estrito por tenant (sem inferência cross-tenant) |
| Selos de suficiência | 3 estados (Fundamentada/Resposta parcial/Evidência insuficiente): evidência precisa satisfazer a intenção (consulta jurisprudencial sem trecho de jurisprudência, ou diploma citado sem trecho dele → "Evidência insuficiente"); geração truncada nunca é "Fundamentada" |
| AI-015 fail-closed (provider) | Fallback implícito para `MockAIProvider` PROIBIDO em staging/production — `selectProvider` lança `NoRealAIProviderError`; sem provider real a consulta fica `failed` e NÃO persiste resposta oficial; erro de runtime do Gemini não cai no mock; mock só em dev/test com `AI_ALLOW_MOCK_FALLBACK=true` (default false), marcado `provider=mock` e nunca "Fundamentada". Testes: `ai-015-mock-fallback-policy.test.ts` (9) |
| Corpus municipal | Investigação: fixture da Lei 769 correto (tenant 700001, município Moreira Sales); não localização em staging era de **cadastro** (`organizations.municipio`), não de ingestão. Sistema deixou de afirmar ausência de normas municipais; ação operacional registrada |

**Validações (snapshot pós AI-015 fail-closed):** typecheck 0 erros · build ok · suíte **3924 passed /
92 skipped / 0 falhas** · smokes de isolamento MySQL executam em CI (skip local sem DB) · secret scan
limpo no range da série · validação funcional manual no staging **concluída com sucesso**.

**Fora do escopo desta série (permanecem):** migração para `@google/genai`, revogação da chave antiga,
alterações em produção, e a PR B (fluxo operacional canônico). G7/G8/G11 e as ações operacionais de
G4/G5 seguem pendentes conforme a tabela do Gate.

---

## Veredito do gate

**`NÃO PRONTO` no estado atual.** Torna-se **`PRONTO COM RESTRIÇÕES`** somente quando **todos os
itens aplicáveis do Gate Obrigatório estiverem em `PASS`** — o que exige concluir
**Bloco A (segurança — obrigatório)**, **Bloco B (fluxo/UI)** e **Bloco D (gate de CI + /health +
timeout de IA + backup agendado com teste de restauração)**, resolvendo também os itens `PARTIAL`
(G6/G8/G11) e o `NOT_VERIFIED` (G4), com os módulos fora de escopo ocultos. Em particular, **G11
(backup/restore) permanece bloqueante** até haver backup agendado e ao menos um teste de
restauração bem-sucedido; e **G4** exige `ADMIN_PASSWORD` obrigatória confirmada no ambiente. O
Bloco C (governança cognitiva) é aceitável como correção durante o piloto.
