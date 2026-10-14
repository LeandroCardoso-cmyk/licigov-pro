# Product Roadmap — LiciGov Pro

**Atualizado:** Outubro 2026 (ciclo "Jornadas integradas"; seções de maio/2026 preservadas abaixo)  
**Versão:** 1.1

> Fonte de verdade da filosofia: [`docs/architecture/PRODUCT_NORTH_STAR.md`](../docs/architecture/PRODUCT_NORTH_STAR.md).
> Regras de execução: `CLAUDE.md` (LICIGOV-FAST). Roadmaps por domínio em `docs/business-domains/*/roadmap.md`.

---

## Ciclo atual (out/2026) — Jornadas institucionais completas

Mudança de estratégia do Owner: entregar **jornadas utilizáveis de ponta a ponta**, reutilizando a arquitetura
existente (REUTILIZAR → INTEGRAR → CORRIGIR → ESTENDER → CRIAR), homologadas em **staging isolado** antes de produção.

### Mapa de reutilização (Graphify `874ed8e` confrontado com o código)

| Componente | Estado | Reutilização | Lacuna real |
|---|---|---|---|
| DFD | FUNCIONAL | Pré-preenchido do contexto canônico, sem IA (`procurementProcessService.generateDFDDraft`, `dfdPrefill`); exporta DOCX/PDF | — |
| ETP | FUNCIONAL | Autoria estruturada reutiliza o DFD (`authoringContext` + `upstreamAuthority`) | — |
| TR | FUNCIONAL | Reutiliza DFD+ETP, itens canônicos e parâmetros estruturados (`renderTrStructuredBlock`) | Itens canônicos com quantidade prevista são pré-requisito (decisão HD-01) |
| Edital | FUNCIONAL (motor padrão) · PARCIAL (modelo BLL) | Motor institucional (`templateCompositionService`, AST v2, catálogo v2, M1/M2, reuso de contexto) | Revisão 2 (datas diferidas) depende de ativação institucional na org real (política/evidência → disponibilizar → troca atômica de binding) |
| Motor documental | FUNCIONAL p/ Edital · PREPARADO p/ demais | `TemplateDocumentKind` já cobre dfd/etp/tr/edital/parecer/contrato/aditivo; Governance V2 (templates próprios/derivados) | Só existe pacote de modelo para o Edital BLL; demais tipos precisam de pacote (não de motor novo) |
| Contratos | PARCIAL | Contract Workspace (avulso, de processo, de contratação direta, reconstrução de externo), RBAC, CAS, timeline | Ativação `minuta → vigente` pendente de definição jurídica (`docs/design/CONTRACT_ACTIVATION_TRANSITION.md`) |
| Aditivos / apostilamentos | FUNCIONAL sobre contrato vigente | Instrumentos com sequência atômica, linhagem própria, termo gerado e exportável | Finalização pós-parecer (valor/quantitativo) e tipo "reequilíbrio" ainda não existem |
| Contratação direta | FUNCIONAL (sem homologação integrada ainda) | Entrada sem DFD (`startOption: sem_dfd`), documentos oficiais, contrato derivado | — |
| Parecer jurídico | PARCIAL | Workspace, assinatura, versão `emitido`, export | Entrada só via solicitação institucional (não avulsa) |
| Processos legados | FUNCIONAL (acompanhamento) · **corrigido** (contrato vigente) | Registros operacionais + importação assistida; **novo** `contractWorkspace.registerInForceContract` | Importação de contrato pelo pipeline de ingestão não existe (usa reconstrução assistida) |
| Calendário | FUNCIONAL | Eventos operacionais + registros com data (grade mensal) | Contratos/processos não alimentam o calendário sem término informado (regra explícita, de propósito) |
| Centro de Operações | FUNCIONAL · **corrigido** | Painel, indicadores, recomendações, timeline | Indicador "vencendo" contava alertas (inflado) — corrigido |

### Staging alinhado (checkpoint de 14/10/2026)
- Linha de homologação `staging` = `main@874ed8e` + PR #297 (squash `2ddcdf5`, árvore idêntica à do head aprovado nos 5 gates).
- Railway/staging passou a acompanhar a branch `staging` (antes `feat/f-emb1-embedding-lineage@b4c6bad`, sem commits
  próprios pendentes); mudança aplicada só no ambiente staging; produção sem alteração.
- Deploy `c7868b88-8bb6-4eb8-98a1-5c34bd6dc56d` **SUCCESS**: pre-deploy oficial (`pnpm db:release:predeploy`, lock de
  migração) aplicou as migrations pendentes 0302→0318; reference data `noop` (draft, não ativado); boot validou pelo
  ledger que `0318_template_governance_transition` está aplicada + tabelas/FKs críticas; health check `/readyz` aprovado.
- Isolamento: `DATABASE_URL` de staging é referência ao MySQL do próprio ambiente; buckets S3 distintos
  (staging `licigov-pro-staging` × produção `licigov-pro-storage-msales`), confirmados pelo Owner.
- **Pendente:** tenant sintético de homologação — exige administrador de plataforma em staging (`organizations.adminCreate`
  + convites por papel); ver relatório do checkpoint.

### Entregue neste ciclo
- PR #296 — pendências de publicação do Edital visíveis e não bloqueantes (Revisão 1 preservada).
- Contrato **vigente de processo anterior** registrado por declaração (sem recriar DFD/ETP/TR/Edital) → aditivo direto;
  origem `legado`, informação **DECLARADA** (não verificada) na timeline; não altera a ativação de minutas.
- Término de vigência no Cadastro Rápido (contrato/aditivo/ata externos) ⇒ vencimento + alertas 90/60/30/15/7d automáticos.
- Indicador "contratos vencendo" conta contratos (um por referência, janela de 90 dias), não alertas.
- Smoke integrado `integrated-journeys-mysql-smoke` (J1 processo novo, J2 legado→contrato→aditivo, J3 monitoramento).

### P0 — disponibilização funcional
- ✅ Staging alinhado à baseline de produção (branch `staging`, banco/secrets/storage próprios) — 14/10/2026. ⏳ Homologação integrada pelas telas (tenant sintético).
- Motor documental reutilizado; jornada DFD → ETP → TR → Edital com placeholders contextuais, elaboração e exportação.
- Entrada flexível de processos legados (acompanhamento, contrato vigente, aditivo).
- Ativação da Revisão 2 do Edital BLL na organização real — **decisão institucional da prefeitura**, nunca simulada.

### P1
- Contratos e aditivos: comando de ativação de minuta (após definição jurídica), finalização de aditivo pós-parecer, reequilíbrio.
- Contratação direta: homologação integrada da jornada completa.
- Parecer jurídico assistido: entrada avulsa (sem solicitação prévia) com análise/conclusão/assinatura humanas.
- Calendário e Centro de Operações: datas de sessão do processo e vigência de contratos do workspace como fontes, com regra explícita.
- Templates próprios e derivados para DFD/ETP/TR/contrato/aditivo (pacotes no mesmo motor).

### P2
- Integrações adicionais (PNCP, CATMAT/CATSER ampliado, assinatura digital).
- Ampliação de modelos por prefeitura.
- Inteligência contextual avançada.
- Refinamentos operacionais.

> As seções abaixo são o roadmap de maio/2026, preservado como histórico. Entregas posteriores estão registradas acima
> e nos roadmaps por domínio; nenhum item concluído foi rebaixado por esta reorganização.

---

## Visão do Produto

LiciGov Pro é o sistema de gestão de licitações públicas mais avançado do Brasil, projetado para conformidade total com a Lei 14.133/2021 e operação segura em ambiente multi-tenant enterprise.

---

## Progresso Atual

| Sprint | Título | Status | Testes |
|--------|--------|--------|--------|
| Sprint 1 | Multi-tenant Foundation | ✅ Concluída | ~56 |
| Sprint 1.5 | Hardening Multi-tenant | ✅ Concluída | 22 |
| Sprint 1.8 | Optimistic Locking | ✅ Concluída | — |
| Sprint 2 | Core Documental | ✅ Concluída | 55 |
| Sprint 2.5 | Hardening Documental | ✅ Concluída | 76 |
| Sprint 2.8 | Import Foundation Layer | ✅ Concluída | 99 |
| **Sprint 3** | **Import Avançado + CATMAT** | 📋 Planejada | — |
| Sprint 4 | IA Assistente | 📋 Planejada | — |
| Sprint 5 | Dashboard + Analytics | 📋 Planejada | — |
| Sprint 6 | Assinatura Digital | 📋 Planejada | — |

---

## Curto Prazo (Sprint 3)

### Import Avançado
- Extração real PDF com `pdf-parse`
- Extração real DOCX com `mammoth`
- Normalização semântica de itens
- Interface de revisão humana (aprovação/rejeição por item)

### CATMAT/CATSER
- Import completo do catálogo CATMAT
- Matching semântico item bruto → código CATMAT
- Score de matching com threshold configurável

### Queue Persistente
- Migração de fila em memória → BullMQ + Redis
- Jobs persistentes entre deploys
- Dashboard de filas

### ItemTR Integration
- Aprovação de staging → ItemTR no domínio
- Regras de negócio Lei 14.133/2021
- Proveniência preservada

---

## Médio Prazo (Sprint 4–5)

### Sprint 4 — IA Assistente
- Sugestão automática de descrição normalizada (LLM)
- Matching CATMAT assistido por IA
- Revisão automatizada de cláusulas contratuais
- Detecção de inconsistências entre TR e proposta

### Sprint 5 — Dashboard + Analytics
- Painel de controle por organização
- Indicadores de pesquisa de preço
- Histórico de importações com métricas
- Relatórios de conformidade Lei 14.133/2021
- Alertas de prazo e validade de documentos

---

## Longo Prazo (Sprint 6+)

### Sprint 6 — Assinatura Digital
- Assinatura eletrônica de documentos
- ICP-Brasil (certificados digitais)
- Protocolo de assinatura multi-parte
- QR Code de autenticidade

### Sprint 7 — Integrações Governamentais
- PNCP (Portal Nacional de Contratações Públicas)
- ComprasNet
- Diário Oficial Eletrônico
- SIAFI/SIAPE (federal)

### Sprint 8 — Mobile + Offline
- App mobile para revisão de documentos
- Modo offline com sincronização
- Notificações push de prazos

---

## Invariantes do Produto

1. **Multi-tenant**: `organizationId` obrigatório em toda operação
2. **Staging barrier**: raw extraction nunca persiste no domínio
3. **Auditoria imutável**: timeline e activity_logs são append-only
4. **Conformidade LGPD**: retenção por classe, purge com legalHold
5. **Integridade criptográfica**: SHA-256 em versões e snapshots
