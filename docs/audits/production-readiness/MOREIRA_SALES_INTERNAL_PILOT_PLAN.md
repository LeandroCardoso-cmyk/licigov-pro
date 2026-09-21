# Plano Mestre — Piloto Institucional Interno · Prefeitura Municipal de Moreira Sales

> **Escopo:** piloto interno, tenant único, 3 usuários reais do Departamento de Licitações.
> **Objetivo do documento:** transformar software tecnicamente preparado (Production Gate 12/12) em
> produto institucional comprovado pelo uso real, preservando autonomia humana, governança,
> rastreabilidade, segurança jurídica e observabilidade.
> **Não contém** senhas, tokens, JWT, credenciais ou secrets — apenas mecanismos e caminhos.
>
> Documento canônico de piloto (companheiro de [`PILOT_CLOSURE_REPORT.md`](./PILOT_CLOSURE_REPORT.md)
> e [`INTERNAL_PRODUCTION_GATE.md`](./INTERNAL_PRODUCTION_GATE.md)). Não criar caminho paralelo.

## 1. Objetivo

Validar o LiciGov Pro em uso institucional real **antes** de qualquer disponibilização comercial a
outras prefeituras. O piloto existe para **descobrir**, não para provar perfeição:

- problemas de UX, retrabalho desnecessário, pontos de abandono;
- lacunas funcionais e inconsistências documentais;
- funcionalidades mais/menos úteis; tempo economizado; qualidade dos documentos;
- aderência à rotina do servidor público; qualidade e taxa de aceitação/rejeição das sugestões de IA;
- dificuldades de aprendizado; problemas reais não detectados por testes automatizados.

## 2. Escopo

**Dentro:** uso integrado da plataforma no fluxo real do departamento, com foco no fluxo documental
`DFD → ETP → TR → EDITAL → CONTRATAÇÃO` e nos 5 Business Domains canônicos.

**Fora (deliberado):** PNCP, ERP, integrações externas, RC-X, expansão comercial, novo corpus
jurídico, features experimentais. **Razão de produto:** o LiciGov Pro é a **camada cognitiva e
operacional do Departamento de Licitações** — não substitui o ERP municipal (publicação, PNCP,
contabilidade, financeiro, execução administrativa permanecem no ERP da prefeitura). PNCP/ERP **não
são lacunas de prontidão** do piloto; são integrações futuras opcionais.

## 3. Usuários

Três usuários internos, **cada um com identidade e conta individual** (nunca conta compartilhada):

1. **Owner / usuário atual** — papel `owner`.
2. **Servidor do Departamento — Usuário Piloto A** — dado real **PENDENTE (owner)**; papel sugerido `operator` ou `manager`.
3. **Servidor do Departamento — Usuário Piloto B** — dado real **PENDENTE (owner)**; papel sugerido `operator` ou `manager`.

Nomes/e-mails dos dois servidores **não são inventados** nesta etapa; apenas o mecanismo de
provisionamento está preparado (ver §"User Provisioning"). Acesso amplo às funcionalidades **sem
remover RBAC**: identidade, roles, autoria, reviewer/approver, timeline e SoD permanecem ativos —
cada ação continua atribuída ao usuário real que a executou.

## 4. Tenant

Execução **exclusiva** no tenant institucional produtivo da **Prefeitura Municipal de Moreira Sales**.

- O tenant produtivo real **não está hardcoded no código** (por design, sem ID fixo) — deve ser criado
  em runtime via `/admin/organizacoes` (tabela `organizations`, `drizzle/schema.ts`). **PENDENTE (owner)**.
- **Não confundir** com o ID sintético `700001` (`server/services/officialCorpus/officialCorpusBuilder.ts`
  — `MOREIRA_SALES_TENANT_ID`), que serve **apenas** ao corpus jurídico de teste/RAG e **não** é o tenant
  produtivo (ver `docs/ops/ONBOARDING_MOREIRA_SALES.md`). Tenant sintético/fixture/seed **nunca** vira
  produtivo por conveniência.

## 5. Funcionalidades liberadas

Módulos vivos e governados (navegação canônica `client/src/config/businessDomains.ts` + `App.tsx`):

- **Home / Dashboard executivo** (`/dashboard`), **Centro de Operações** (`/centro-operacoes`);
- **Processos** `/processos` — fluxo `DFD → ETP → TR → EDITAL` (Edital canônico já em produção, PR #237);
- **Contratação Direta** (`/contratacao-direta`), **Parecer Jurídico** (`/parecer`), **Contratos** (`/contratos`) + alertas;
- **Documentos**: revisão documental, versionamento imutável, timeline/histórico, exportação DOCX/PDF;
- **CATMAT/CATSER** existentes; **RAG jurídico governado**; **copilotos institucionais**; **explainability** (GroundingNotice);
- **Templates**, **Configurações**, **Usuários/Admin Organizações**, **Tirar Dúvidas** (RAG);
- **Colaboração** já implementada; **auditabilidade** (activity logs + timelines append-only).

**Ocultos/legado (não liberar):** billing/assinaturas e relatórios financeiros (telas comentadas em
`App.tsx`); rotas legadas com redirect de compatibilidade; rotas `/test*` (removidas). Não esconder
módulos prontos artificialmente; ocultar apenas o comprovadamente incompleto/experimental.

## 6. Exclusões

PNCP · ERP · integrações externas · RC-X · F-RAG1 APPLY · F-EMB1 APPLY · ativação de novo corpus
legal · expansão comercial · nova arquitetura documental · rich editor · diff/comentários/menções
avançados · validação cross-document avançada.

## 7. Fluxo documental prioritário

`DFD → ETP → TR → EDITAL → CONTRATAÇÃO`. Observar: fluidez entre documentos, baixa redigitação,
reaproveitamento de contexto, utilidade da IA, robustez do documento final, clareza da origem das
informações, e a experiência do **Edital canônico** (qualidade da 1ª minuta, reaproveitamento
DFD/ETP/TR, velocidade, volume de revisão, marcadores `[REVISAR]`, grounding, detecção de
`source_changed`). Caminho canônico do Edital (não reativar legado):
`EditalWorkspace → procurementProcess.generateNotice → Context Builder → pipeline cognitivo →
RAG governado → draft → review → approval → export`.

## 8. Métricas (enxutas, explicáveis — sem score opaco, sem ranking de servidores)

O piloto avalia **o produto**, não a performance individual dos funcionários.

- **Adoção:** usuários que efetivamente usam · sessões · processos iniciados.
- **Eficiência:** tempo aproximado para preparar cada documento · grau de reaproveitamento · nº de revisões.
- **IA:** gerações bem-sucedidas · erros · retries · recomendações aceitas/rejeitadas · necessidade de correção humana.
- **Produto:** funcionalidades utilizadas · etapas abandonadas · principais fricções.
- **Qualidade:** retrabalho · inconsistências encontradas · documentos considerados utilizáveis.

Cada métrica deve ser **explicável, observável e contextualizada** — nunca um único "AI Score" opaco.

## 9. Feedback dos servidores

Mecanismo **leve** na largada (sem plataforma de pesquisa complexa): registro contextual/administrativo
capturando, por ocorrência: *o que tentou fazer · o que esperava · o que aconteceu · impacto · sugestão*.
Pode evoluir para feedback in-app apenas se o uso justificar (P2).

## 10. Classificação de problemas

- **P0 — bloqueante:** perda de dados; vazamento cross-tenant; autenticação quebrada; documento
  perigosamente incorreto; aprovação indevida; corrupção; indisponibilidade crítica.
- **P1 — alta:** fluxo importante não funciona; geração falha com frequência; usuário não completa tarefa central.
- **P2 — melhoria:** UX, produtividade, conteúdo, refinamento.
- **P3 — dívida:** otimizações, arquitetura não crítica, polish.

## 11. Observabilidade (o que já existe)

Infra: `server/services/observabilityService.ts` (`structuredLog`/`timed`/`span`/`serviceLogger`) +
~35 serviços de observabilidade especializados. Sinais já registráveis:

| Sinal | Onde |
|---|---|
| Logins / sessões | JWT (`jose`) + `activity_logs` (ações auth via `logActivity`) |
| Processo / DFD / ETP / TR / Edital | `process_timeline`, `document_timeline`, `activity_logs` (com `processId`/`entityType`) |
| Documentos / versões / revisões / aprovações | `document_versions` (imutável), `documentTimelineService`, SoD approvals |
| Falhas cognitivas / duração / replay / retries | `cognitive_observability` (`latencyMs`, `replayHash`, `executionStatus`), `execution_replays`, `execution_rollbacks`, `draft_generations`, `ai_execution_audits` |
| Recomendações aceitas/rejeitadas (CATMAT) | `aiUsageTracker.trackCATMATMatching` ← `processesRouter` |
| Exports | `contractObservabilityService`, `legalOpinionObservabilityService`, adapters de export |
| Painéis | `ExecutiveDashboard` (`/dashboard`), `AIUsageDashboard` (`/admin/ai-costs`), `ActivityReport` (`/auditoria`), Centro de Operações |

**Lacunas não bloqueantes:** custo/tokens de geração DFD/ETP/TR/Edital não agregados no
`AIUsageDashboard` (hoje só CATMAT); `trackDocumentGeneration`/`trackEmbedding`/`trackRAGQuery` são
exports sem call-site em produção (geração é observada por `cognitive_observability`); tela dedicada
`AuditLogs` está comentada (auditoria via `/auditoria`). Nenhuma bloqueia o piloto. Não implementar
tracking invasivo nem registrar conteúdo sensível desnecessário.

## 12. Segurança e governança

- IA permanece **supervisionada, assistiva, approval-aware e explicável**. Nunca aprova, decide
  juridicamente, publica ou altera documento oficial silenciosamente.
- **SoD fail-closed** na aprovação/emissão (`documentWorkflowService`, `documentPromotionService`):
  ator humano identificado; revisor/emissor ≠ autor; recusa se autoria não for rastreável.
- **Isolamento multi-tenant:** `organizationId` sempre derivado no servidor (`tenantProcedure`);
  admin de plataforma exige `X-Organization-Id` validado com auditoria fail-closed.
- **Rastreabilidade:** `activity_logs`/`audit_logs` com snapshots imutáveis de ator + timelines append-only.
- O servidor público continua responsável por revisão, validação, decisão e aprovação.

## 13. Dados reais

Confirmar antes da entrada: isolamento de tenant, backup, audit trail, versionamento, acesso,
autorização, proteção contra exclusão indevida e prontidão de storage (S3). **Começar com processos
novos** — não importar massa histórica; não reconstruir processos antigos para "encher" o sistema
(permanecem nos ERPs/arquivos). Registro de legacy futuro, se necessário, pela via governada já prevista.

## 14. Backup / Rollback (readiness — NÃO executar)

- **Backup:** `.github/workflows/db-backup.yml` — diário 06:00 UTC + manual; `mysqldump
  --single-transaction` → gzip → AES-256-CBC/PBKDF2 (se chave presente) + checksum SHA-256; retenção 14d.
  Drill de restauração real gated com verificação de isolamento tenant (`DB_RESTORE_DRILL_EVIDENCE.md`).
- **Restore:** `docs/ops/DB_RESTORE_RUNBOOK.md`.
- **Rollback de deployment:** Railway — redeploy do build anterior; healthcheck `/readyz`,
  `restartPolicyType: ON_FAILURE`. DDL não tem rollback transacional → estratégia é **forward-fix**
  (`docs/ops/MIGRATION_RELEASE_RUNBOOK.md`).
- **Kill-switch / feature flags:** `feature_flags` (global) + `tenant_feature_flags` (override por
  tenant, rollout %); precedência kill-switch → tenant → global → default (`featureFlagAdminService`).
- **Como interromper o piloto sem perder dados:** desabilitar a superfície problemática via feature flag
  (não apagar dados), ou redeploy do build anterior no Railway; dados persistem no MySQL (com backup
  cifrado disponível). **PENDENTE (operador):** confirmar presença/rotação dos secrets de produção
  (`JWT_SECRET`, `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`) — fora do código.

## 15. Critérios de pausa (interromper imediatamente)

Vazamento cross-tenant · corrupção/perda de dados · autorização indevida · IA efetuando decisão
autônoma · inconsistência jurídica grave produzida sistematicamente · falha persistente de
autenticação · falha crítica de banco · replay criando duplicidade perigosa.

## 16. Critérios de conclusão (piloto bem-sucedido — sem exigir perfeição)

Servidores usam sem acompanhamento constante · fluxos principais funcionam · documentos economizam
trabalho · IA agrega valor · revisão permanece humana · problemas são controláveis · sem riscos P0
estruturais · produto mostra aderência à rotina.

## 17. Decisão de mercado (posterior)

Não há liberação comercial nesta etapa. Após período suficiente de uso, consolidar bugs, melhorias,
feedback, métricas e dívidas; então realizar avaliação **Pilot → Market Readiness** e só então decidir
comercialização. Durante o piloto vale **feature freeze relativo**: prioridade P0 → P1 → UX comprovada
pelo uso → melhorias diretamente ligadas ao piloto; **CORRIGIR > REESCREVER**.

---

## Estado atual (referência)

Production Gate G1–G12 **12/12 PASS**; G5/G8 PASS; F-LEGAL V1 e F-RAG1 fechados; P0 Edital canônico
**merged** (PR #237, commit `905d3cd`); auto-deploy Railway `76d15a0a` **SUCCESS**, `/readyz` PASS,
banco saudável, reference-data `noop`/não ativado, sem migration inesperada. **Piloto NÃO iniciado**;
RC-X NÃO iniciado. A autorização de go-live é decisão **exclusiva do owner** — a IA não a concede.
