# Gate de Produção Interna
### LiciGov Pro · Piloto Moreira Sales · 2026-07-22

**Pergunta que este gate responde:**
> O LiciGov Pro pode ser utilizado internamente pela Prefeitura de Moreira Sales com risco
> institucional aceitável?

**Resposta atual (pós-PR A): NÃO — 6 dos 12 itens do Gate Obrigatório ainda não estão em `PASS`**
(2 FAIL + 4 PARTIAL). A PR A (Bloco A) fechou G1/G2/G3/G6 (isolamento, ops, escalação, registro)
e reduziu G4/G5 a PARTIAL (dependem de ação operacional no Railway). Restam Blocos B/D e backup.
Status por item: **PASS** · **FAIL** · **PARTIAL** · **NOT_VERIFIED** · **N/A**.

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
| G4 | Sem credencial default em produção | **PARTIAL** | CONFIG-005: código exige `ADMIN_PASSWORD` em produção (sem default); PASS = var confirmada no Railway (OPERATOR_ACTION_REQUIRED) |
| G5 | Segredos fora do repositório e rotacionados | **PARTIAL** | SEC-018: `.env` removido do índice; PASS = rotação dos segredos (runbook, OPERATOR_ACTION_REQUIRED) |
| G6 | Registro não permite entrada indevida no tenant do órgão | **PASS** | RC-SEC-PR-A: SEC-017 corrigido (fallback org 1 removido; registro fail-closed) |
| G7 | CI comprova que o projeto compila e o isolamento não regrediu | **FAIL** | DEPLOY-019/049; PASS = build+typecheck+smokes de isolamento no gate |
| G8 | Fluxo principal navegável e sem telas de debug/duplicadas | **PARTIAL** | UI-054, LEGACY-013; PASS = rotas de teste e legadas fora da navegação |
| G9 | Login/sessão/logout funcionais | **PASS** | JWT httpOnly ok (ressalva SEC-022: expiração 1 ano) |
| G10 | Suíte de testes verde no snapshot | **PASS** | 3805 passed / 74 skipped / 0 falhas; typecheck 0 erros; build ok |
| G11 | Backup e restauração disponíveis | **PARTIAL** | DEPLOY-051; backup manual + DR documentado; **restore nunca testado**. PASS = backup agendado/automatizado + retenção definida + ≥1 teste de restauração bem-sucedido registrado |
| G12 | IA nunca serve conteúdo mock como oficial sem sinalizar | **FAIL** | AI-015; PASS = fallback visível + `GEMINI_API_KEY` garantida |

**Resultado do Gate Obrigatório (pós-PR A): 6 PASS · 2 FAIL · 4 PARTIAL · 0 NOT_VERIFIED · 0 N/A (total 12).**
PASS: G1, G2, G3, G6, G9, G10 · FAIL: G7, G12 · PARTIAL: G4, G5, G8, G11.
Pela regra de bloqueio acima, enquanto qualquer item aplicável não estiver em `PASS` — incluindo
os `PARTIAL` (G4/G5/G8/G11) — o go-live **não** é autorizado. A PR A moveu G1/G2/G3/G6 para PASS
e G4/G5 de FAIL/NOT_VERIFIED para PARTIAL (falta ação operacional: `ADMIN_PASSWORD` no Railway e
rotação de segredos). G7/G12 seguem para o Bloco D; G8 para o Bloco B; G11 para backup/restore.

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
| 15 | Consegue usar Tirar Dúvidas? | **Sim** | Corpus real + citações |
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

## Veredito do gate

**`NÃO PRONTO` no estado atual.** Torna-se **`PRONTO COM RESTRIÇÕES`** somente quando **todos os
itens aplicáveis do Gate Obrigatório estiverem em `PASS`** — o que exige concluir
**Bloco A (segurança — obrigatório)**, **Bloco B (fluxo/UI)** e **Bloco D (gate de CI + /health +
timeout de IA + backup agendado com teste de restauração)**, resolvendo também os itens `PARTIAL`
(G6/G8/G11) e o `NOT_VERIFIED` (G4), com os módulos fora de escopo ocultos. Em particular, **G11
(backup/restore) permanece bloqueante** até haver backup agendado e ao menos um teste de
restauração bem-sucedido; e **G4** exige `ADMIN_PASSWORD` obrigatória confirmada no ambiente. O
Bloco C (governança cognitiva) é aceitável como correção durante o piloto.
