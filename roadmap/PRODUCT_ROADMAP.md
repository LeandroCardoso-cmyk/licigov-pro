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
- Tenant sintético `homologacao-sintetica` criado pelo Owner (administrador de plataforma), com usuários de teste.
- Integração de #301 → #300 → #299 → #298 por squash, cada merge com deploy automático SUCCESS em staging.

### Entregue neste ciclo
- PR #296 — pendências de publicação do Edital visíveis e não bloqueantes (Revisão 1 preservada).
- Contrato **vigente de processo anterior** registrado por declaração (sem recriar DFD/ETP/TR/Edital) → aditivo direto;
  origem `legado`, informação **DECLARADA** (não verificada) na timeline; não altera a ativação de minutas.
- Término de vigência no Cadastro Rápido (contrato/aditivo/ata externos) ⇒ vencimento + alertas 90/60/30/15/7d automáticos.
- Indicador "contratos vencendo" conta contratos (um por referência, janela de 90 dias), não alertas.
- Smoke integrado `integrated-journeys-mysql-smoke` (J1 processo novo, J2 legado→contrato→aditivo, J3 monitoramento).

### Progresso por marco (integrador — atualizado em 15/10/2026 após a homologação E2E HTTP real em staging)

Legenda de evidência: **SMOKE** = MySQL real + IA mock (CI) · **HTTP-LOCAL** = executor oficial `pnpm homolog:e2e` contra o
MESMO middleware tRPC do servidor (login/cookie/RBAC reais, IA mock, storage em memória) · **STAGING** = execução no staging.
Homologação visual: **parcial** em 16/10/2026 (processo `2026/9001`, org 2) — DFD, pesquisa, itens e ETP percorridos; TR
bloqueado e Edital BLL não alcançado. Achados e correções na seção "Rodada M8 — homologação visual" abaixo; roteiro em
`docs/ops/M8_STAGING_HOMOLOGATION_RUNBOOK.md`.

| Marco | Peso | % | Evidência | Próxima ação / bloqueador |
|---|---|---|---|---|
| M0 — Staging e baseline | 10 | 100 | Deploy SUCCESS a cada merge; ledger até 0318; MySQL/S3 próprios; tenant `homologacao-sintetica` | — |
| M1 — Graphify e reutilização | 5 | 100 | Mapa de reutilização; grafo regenerado por merge e idempotente | — |
| M2 — BLL diferido | 10 | 90 | Minuta BLL Rev. 2 gerada sobre TR emitido: 7 dados "A DEFINIR PARA PUBLICAÇÃO", 0 datas inventadas (SMOKE + HTTP-LOCAL) | Rev. 2 vinculada no tenant sintético do staging; ativação na org real é decisão institucional |
| M3 — Motor documental | 10 | 90 | Mesmo motor para Edital BLL; mesma exportação/versionamento para DFD/ETP/TR/termos | Pacotes de modelo para os demais tipos |
| M4 — Jornada principal | 15 | 90 | DFD → ETP → TR (emitido por outro usuário) → Edital BLL → DOCX/PDF, replay (SMOKE + HTTP-LOCAL; STAGING contado em M8) | Homologação visual (produtividade do TR) |
| M5 — Processos legados | 10 | 90 | Registro legado → contrato vigente → histórico declarado → aditivo; extrator de importação corrigido (STAGING contado em M8) | Homologação visual |
| M6 — Contratos/aditivos/direta | 10 | 80 | Reagendamento de vigência, termo DOCX/PDF; contratação direta sem DFD (SMOKE) | Ativação de minuta e pós-parecer pendentes (jurídico) |
| M7 — Pareceres/monitoramento | 10 | 80 | Calendário/alertas/indicador sem duplicidade (HTTP-LOCAL); pedido de parecer sem parecer fabricado (SMOKE) | Parecer avulso |
| M8 — Homologação E2E staging | 15 | 80 | **HTTP real APROVADO 4/4 em STAGING** (run `MV9SXMKG`, 15/10/2026, org 2, processo `4256/2026`); executor com guardas de destino/tenant/credencial/papel | Homologação visual (20% restantes do marco) |
| M9 — Regras/roadmap/integração | 5 | 95 | #298–#304 integrados por squash; conflitos só em artefatos do Graphify (regenerados) | — |
| **Global ponderado** | 100 | **88,25** | Σ(peso × %) / 100; cada entrega contada num único marco | — |

**Cálculo rastreável:**
- Global anterior: **83,75%**, valor histórico até 15/10/2026, antes da execução em staging.
- O que mudou foi só o M8, de 50% para 80%. Composição do marco:
  - 50%: executor pronto e verde em HTTP-LOCAL (já contado);
  - +30%: execução HTTP real **em STAGING** aprovada 4/4;
  - 20%: homologação visual, pendente.
- Novo global = 83,75 + 15 × (80 − 50) / 100 = **88,25%**.
- M2, M4 e M5 ficaram **inalterados**: a evidência de staging é contada só uma vez, no M8.
- **88,25% não significa plataforma homologada para produção.** Faltam a homologação visual, a ativação na organização
  real (decisão institucional) e os itens pendentes de M3, M6 e M7.

### Rodada M8 — correções da homologação real em staging (15/10/2026)

Origem: homologação manual do Owner no tenant sintético (org 2 "Prefeitura Sintética — Homologação", processo 2026/0001 —
histórico preservado; a validação desta rodada usa processo sintético NOVO). Branch `fix/m8-homologation-round` → PR para `staging`.

| ID | Defeito / melhoria | Correção | Evidência |
|---|---|---|---|
| M8-PRICE-IMPORT-001 | 1 item com 3 cotações virou 36 itens / 46 cotações (leitor "uma linha = um item"); CATMAT para metadados | Leitor estruturado (cabeçalho/metadado/item/quantidade/unidade/cotação/aviso), prévia sem gravação, ambiguidade recusada sem escrita, fonte fictícia sinalizada, CATMAT só para item real, resíduos antigos sinalizados para rejeição humana | Unit + SMOKE J4 (1 item, 3 cotações, média R$ 4.000,00, total R$ 40.000,00, reimportação idempotente, isolamento) |
| M8-AI-DFD-001 | Metadados da IA ("Pontuação de confiança", "Fatos utilizados") no texto do DFD | Contrato estruturado {parágrafos, lacunas, avisos}, validação por parágrafo antes da apresentação, fallback seguro, inserção sem título duplicado | Unit + SMOKE (provider mock no contrato) |
| M8-UX-GOV-001 | Redigitação de autoridade/cargo/ato em cada campo governado | Autoridade eletrônica do usuário autenticado por padrão; ato formal opcional e completo; evidência jurídica inalterada | Unit (router) + SMOKE FAST-6 |
| M8-TR-UX-001 | TR sem reuso de padrões institucionais em tenant novo | Padrões elegíveis definidos uma vez no Perfil (proposta confirmada por processo; nada aplicado em silêncio); métrica `structuredProposed` | Unit (view-model) |
| M8-EDITAL-UX-001 | Pendências sem indicar o que bloqueiam | Nível de bloqueio por pendência (elaboração × só publicação) + resumo; configuração única explicitada | Unit (view-model) |
| ETP coerência | "Fundamentado" com fatos insuficientes | Fundamentação normativa × suficiência factual; viabilidade preliminar com lacunas; divergência texto × base legal estruturada como ressalva | Unit |

Até a execução em staging, os percentuais ficaram **mantidos** (83,75%). O marco só subiu com a evidência registrada a seguir.

**Histórico de integração em `staging` (15/10/2026):**
- PR #302 integrado em `staging` por squash (`af0aa48`), com os 5 gates do CI verdes.
- Deploy Railway staging `45831881` **SUCCESS**. Predeploy em 124 ms: migrations já em dia, nenhuma nova; reference
  set em noop. Boot `APP_ENV=staging`, S3 ✓, IA ✓, schema validado, sem erros nem avisos após a inicialização.
  Produção não foi tocada.
- PR #303 (`f867a25`): runbook da homologação e estado real; só documentação. Deploy `1d3a7bd6` SUCCESS.
- PR #304 (`034ce42`): o executor envia `X-Organization-Id` a usuários com várias organizações (`HOMOLOG_ORGANIZATION_ID`)
  e exige papel `manager` ou superior. Regras do backend inalteradas. Deploy `9f783de0` SUCCESS.
  - Primeira tentativa no staging: falhou antes das jornadas com "múltiplas organizações". Esta foi a causa da correção.
- O processo 2026/0001 fica preservado como evidência histórica, com os 36 itens do leitor antigo mantidos e sinalizados.
  Nenhuma limpeza foi feita nem é exigida.

#### Marco M8 — Homologação E2E HTTP real: **APROVADO (4/4)**

- **Origem dos dados:** transcrição do relatório fornecido pelo Owner, em
  `docs/ops/evidence/M8_E2E_HTTP_STAGING_2026-10-15.json`, sem validação independente adicional.
- **Execução:**
  - Run `MV9SXMKG`, em 15/10/2026, no Console do Railway staging.
  - Código em staging: `034ce42`.
  - Organização 2 (`homologacao-sintetica`), com papéis `manager` / `manager`.
  - Modo: HTTP real pelas APIs oficiais.
  - Vitest: 1 arquivo e 4 testes aprovados, em 122,97 s.
- **Jornada A:** novo processo `4256/2026` → DFD → ETP → Pesquisa → Itens → TR → Edital BLL **Revisão 2 (BOUND)**.
  - Oito exportações DOCX/PDF, todas em **rascunho**: DFD 9.108/3.911 B; ETP 10.957/9.876 B; TR 11.028/9.898 B;
    Edital 37.911/87.723 B.
  - Não houve publicação oficial nem aprovação jurídica definitiva.
- **Jornada B:**
  - Contrato legado `11dc53b1f99127512a03` registrado, com 1 aditivo anterior reconhecido.
  - Novo término em 2027-11-29.
  - Termo DOCX/PDF com 9.031/3.731 B.
  - Repetição da chamada (replay) validada.
- **Jornada C:** registro `6de147d28fe137a95311`, com 3 eventos no calendário e alertas sem duplicidade, integrados ao
  Centro de Operações.
- **Isolamento:** acesso entre organizações recusado no cenário coberto.
- **Correções M8 validadas no cenário testado** (não generalizar para todos os formatos documentais):
  - Pesquisa de preços: 1 item e 3 cotações, média R$ 4.000,00 e total R$ 40.000,00; 7 linhas não-item ignoradas;
    entrada ambígua recusada.
  - IA do DFD: contrato estruturado, com 7 lacunas e 2 avisos fora do texto e 0 trechos descartados.
- **Pendências legítimas:** são pendências da fase atual, não defeitos.
  - Marcadores `[REVISAR]`: ETP 11, TR 9 e Edital 3. São lacunas factuais e precisam de revisão humana.
  - Publicação diferida: `complete: false`, com 7 dados pendentes, conforme o contrato `DEFERRED_PUBLICATION` da Rev. 2.
    - As 10 ocorrências do texto vêm dessas 7 variáveis; o AST do modelo tem 12 referências, 6 delas ao número do pregão.
    - Nenhuma data fictícia foi preenchida.
- **Limites do escopo:**
  - Não é homologação visual.
  - Os documentos são rascunhos, não documentos oficiais publicados.
  - A IA do staging foi exercitada só na sugestão do DFD.
  - Nada foi executado na organização real.

#### Produtividade operacional (medida na execução) — o que é automático × o que ainda é humano

| Etapa | Automático / reaproveitado | Ainda humano | Leitura |
|---|---|---|---|
| DFD | 6 de 11 campos pré-preenchidos; sugestão de IA estruturada | 5 campos desconhecidos; revisar lacunas (7) e avisos (2) | Adequado; IA supervisionada |
| Pesquisa | 1 item e 3 cotações agrupados; 7 linhas ignoradas | Conferir a prévia e importar | Defeito M8 corrigido no cenário |
| TR | 0 pré-preenchidos, 0 propostas | **21 de 37 parâmetros confirmados manualmente**; 9 `[REVISAR]` | **Maior carga manual restante** |
| Edital BLL | 20 automáticos, 33 do órgão, 21 vindos do TR, 1 projeção do TR | 12 decisões do certame; 7 dados de publicação (depois) | Bom reuso; decisões do certame legítimas |

- **TR:** a ausência de propostas é **efeito do cenário**, não regressão. As propostas vêm só dos padrões institucionais
  do Perfil. O executor registrou o Perfil sem padrões e mediu o TR antes das confirmações.
  - O recurso M8-TR-UX-001 permite definir padrões no Perfil para até 9 campos elegíveis: pagamento, prazos, recebimento
    e reajuste.
  - Esse recurso **não foi exercitado** na execução. Medir na homologação visual quanto ele reduz os 21 campos manuais.
- **Edital:** `MANUAL_DECISIONS_VISIBLE: 0` é o estado medido **depois** das 12 decisões registradas pelo executor, não
  ausência de trabalho humano.

### Rodada M8 — homologação visual (parcial) e correções direcionadas (16/10/2026)

Origem: homologação visual do Owner no staging (`4c4b17d`, deploy `961c848c`), org 2, processo `2026/9001`, Perfil revisão 5
com 9 padrões do TR. Branch `fix/m8-visual-round` → PR para `staging` (sem merge automático). Nenhuma migration; nenhum
processo histórico, binding ou decisão registrada alterados.

**Comprovado na tela (preservado):** padrões do TR reduziram as pendências de 21 para 12 (−42,9%); sugestão de IA do DFD
editada e aceita ("Alterado por você"); importação de preços com 1 item, 3 cotações, 10 unidades, média R$ 4.000,00, total
R$ 40.000,00 e 7 linhas ignoradas; item aprovado (CATMAT não confirmado) e incorporado; ETP com 6 evidências normativas,
8 lacunas factuais e emissão bloqueada por `[REVISAR]`; Edital pedindo modalidade/forma.

| Achado | Classificação | Causa (código) | Tratamento |
|---|---|---|---|
| P1 DFD — `[REVISAR: …]` e hipóteses não fundamentadas na justificativa | **Confirmado** | Prompt mandava marcar lacunas no texto e não proibia presumir motivação/impactos | Prompt `dfd-justificativa/3` + contrato `/2`: frase com marcador sai do texto e vira lacuna listada; recusa explícita quando nada sobra, dizendo o que falta. Lacunas continuam visíveis; aceite humano; histórico intacto |
| P1 TR — "Autoria estruturada inválida (fail-closed) … Fundamentação" | **Confirmado** | O prompt do TR não declarava as seções de mínimo legal; a IA as omitia e a validação (correta) recusava com mensagem técnica | Validação **inalterada**. Prompt declara as seções de mínimo legal (redigir com `[REVISAR]` o que faltar). Recusa traduzida: motivo, onde complementar (ex.: Fundamentação → ETP), próxima ação, e distinção rascunho × emissão. Proveniência `failed` continua gravada; nada é gravado no documento (SMOKE J5) |
| P1 ETP "v1 · gerado" em "Documentos oficiais (versões emitidas)" | **Confirmado (apresentação)** | Cada geração grava um snapshot técnico `gerado` no ledger oficial (append-only, usado no replay); o painel listava tudo | Painel separa versões **emitidas** de "Versões técnicas (snapshots — não emitidas)", recolhidas. Ledger, numeração, hashes e replay inalterados |
| P1 Edital — formulário da aba × fluxo BLL Rev. 2 | **Confirmado (UX)** | Os campos legados (critério/regime) apareciam antes de saber se havia modelo vinculado | Campos legados só aparecem quando não há modelo vinculado; antes disso, orientação única. Nenhum padrão assumido; Rev. 2, binding, `DEFERRED_PUBLICATION` e preflight inalterados |
| P2 indicador de itens sem atualizar após incorporar | **Confirmado** | Invalidação de cache incompleta | Invalida participação dos itens e preparação/preflight do Edital |
| P2 botão "Aprovar item" após aprovado | **Confirmado** | Rótulo não refletia o estado | "Item aprovado" desabilitado com fonte vigente; aprovação desatualizada continua mostrando o motivo. Idempotência do backend inalterada |
| P2 CATMAT "confiança 80%" | **Confirmado** | Candidatos gerados localmente (código derivado da descrição) e pontuados por palavras em comum — não há consulta ao catálogo oficial | Rotulado como "similaridade textual", com aviso de que não é validação oficial. Limiar não configurado; decisões intactas. **Decisão do Owner pendente:** consultar o catálogo oficial (dadosabertos.compras.gov.br) ou deixar de sugerir códigos |
| P2 ETP — conclusões (lote único, benefícios) sem análise | **Confirmado** | Prompt não distinguia fato × conclusão | Regra de inferência no prompt (conclusão sem análise ⇒ `[REVISAR: decisão/análise necessária]`); lista "O que falta completar" por seção no ETP/TR, sem caçar marcadores |
| `Load failed` na 1ª criação do `2026/9001` | **Não reproduzido** | Intermitente de rede/cliente; sem evidência no servidor | Registrado; nenhuma correção especulativa |
| Edital — modalidade/forma vazias após recarregar | **Comportamento conhecido** | O rascunho institucional não persiste esses parâmetros | Documentado para rodada futura (fallback pelo processo/manifesto) |

**Evidência:** client 79 arquivos / 951 testes; servidor afetado 18 / 264; smokes MySQL 16 / 112 (incl. J5 novo); `tsc`,
lint dos arquivos alterados e build limpos.

**Percentuais mantidos (M8 80%, global 88,25%).** Os 20% restantes do M8 exigem a homologação visual completa — TR gerado
e Edital BLL alcançado na tela —, o que ainda não ocorreu.

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
