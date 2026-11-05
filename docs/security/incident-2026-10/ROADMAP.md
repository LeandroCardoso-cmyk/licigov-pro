# Roadmap de remediação — pontuação reconciliada

## Atualização de 05/11/2026 — lote de credenciais concluído

**Lote: 16/16 itens (100% somente do checklist delimitado). P0 geral: aberto.** Evidência consolidada e fontes em [LOTE_CREDENCIAIS_2026-11.md](./LOTE_CREDENCIAIS_2026-11.md). A publicação documental não autoriza merge, deploy, novas chamadas pagas ou novos envios de e-mail.

| Frente / critério original | Evidência nova e limite |
|---|---|
| 1A/1B — inventário e dependências | Contas e consumidores LiciGov mapeados; comparações de variáveis SincroSaúde registradas, com cobertura limitada aos ambientes verificados. |
| 2A — credenciais / consumidores | MySQL regularizado em rodada anterior; D2/D3 aplicados e aceitos. Gemini/AWS/Brevo novos em uso; antigos excluídos por confirmação do Owner. Não é certificação universal de consumidores externos desconhecidos. |
| 2B — revogação e logs | Revogação e validação funcional concluídas para o escopo. **Critério ainda parcial:** falta a revisão histórica dos logs de acesso/consumo disponíveis no período do incidente. |
| 3A/3B — identidade e permissões | Admin real de staging recuperado, senha salva e login confirmado pelo Owner. MFA/administradores/recuperação/OAuth/contas de serviço e escopos gerais continuam pendentes conforme o inventário, sem inferir regularização global. |
| 4A — dependências | #319 e #337 continuam sem liberação; decidir pela evidência de cada PR. Nenhuma mudança de dependência neste bloco documental. |
| 4B/5A/7A — ambiente e testes | Validações sintéticas D2 e seis verificações D3 aceitas; produção por confirmação manual do Owner. Não equivalem à homologação completa do produto ou do isolamento entre tenants. |
| 5B — OAuth/MCP | Aplicabilidade limitada conforme inventário histórico; não houve alteração OAuth/MCP nesta etapa. |
| 6A/6B — operação | Novo projeto Gemini de produção vinculado ao billing por confirmação do Owner. Situação de todo Cloud/Workspace e encerramento/transferência formal SincroSaúde ainda exigem evidência própria. |
| 7B — encerramento | Evidência consolidada, com limitações explícitas; P0 geral continua aberto. Recuperação MySQL comprovada anteriormente com drills delimitados. |

**Não repetir ações já concluídas:** `digital_signatures` de produção retornou zero registros na consulta do Owner em 01/11; staging também retornou zero na coleta anterior. A pendência de contar registros atuais está encerrada nessas datas. Não se presume ausência histórica de dados apagados.

**Orçamento:** nove e-mails comprometidos — sintético 2 (2), sintético 1 (2), produção após D3 (1), entrega pós-desativação Brevo em ambos os ambientes (2), admin real de staging (2). Aviso final de alteração não teve recebimento confirmado separadamente. Nenhum novo envio autorizado.

**Limitações mantidas:** rejeição programática de sessão JWT antiga não demonstrada; `AI_MAX_ATTEMPTS=1` em staging; objetos sintéticos retidos coerentes com os registros; segredo de migrations no mesmo serviço do runtime; restore com verificações mínimas e VERIFY_CA sem hostname; alcance limitado da comparação de consumidores SincroSaúde. Não repetir rotações para preencher lacunas históricas.

**Pontuação global:** não recalculada nesta publicação. A matriz e as pontuações abaixo são o checkpoint histórico de 25/10, não uma avaliação atual. O 100% do lote não substitui os pesos/critérios do incidente. #319/#337 e homologação de produção permanecem sujeitos a decisão própria.

## Histórico — checkpoint de 25/10/2026 (preservado)

> **Versão v2 (25/10/2026, noite).** Referência: o `ROADMAP.md` **original** do Owner ("Roadmap de
> regularização — LiciGov Pro", 25/10/2026), recebido nesta execução. A v1 desta pasta usava critérios
> **reconstruídos** (o original não estava disponível); pesos iguais, critérios diferentes — os totais da v1
> **não** são equivalentes aos do original. A v1 fica abaixo só para rastreio.
>
> Regras do original: pontuação da fase = peso × critérios comprovadamente atendidos / 2; critério pendente,
> bloqueado ou sem evidência não pontua; não aplicabilidade exige justificativa verificável; 100% ≠ risco zero;
> não encerrar com crítico/alto relevante aberto ou ação operacional obrigatória sem validação.
>
> Três leituras por critério: **Auditado** (avaliação concluída com evidência) · **Implementado** (correção
> pronta em código/documento/console) · **Validado** (comprovado por documentos/testes/CI; quando o critério
> exige ambiente aprovado ou provedor, só conta com evidência de lá). **Nenhuma leitura representa produção
> regularizada.**

## Critérios do original × evidência (head desta revisão)

| Fase (peso) | Critério | Aud. | Impl. | Valid. | Evidência / pendência |
|---|---|:-:|:-:|:-:|---|
| 1. Auditoria e inventário (10) | A — repositório, commit implantado, ambientes, serviços, integrações | ✅ | ✅ | ✅ | `AUDIT_REPORT.md` §1, `CREDENTIAL_INVENTORY.md` (Railway MCP, deploys, workflows) |
| | B — achados priorizados, limites de acesso, responsáveis, dependências | ✅ | ✅ | ✅ | Matriz §4, lacunas §5, dependências SincroSaúde no inventário |
| 2. Credenciais (30) | A — inventário coberto e rotação concluída/validada no provedor e em todos os consumidores | ✅ | ❌ | ❌ | Sem comprovação suficiente de rotação pós-incidente; procedimento pronto (`CONTAINMENT_CHECKLIST.md`) |
| | B — antigas revogadas, serviços validados, logs de acesso/consumo revisados no período | ✅ | ❌ | ❌ | Sem acesso a Google/AWS/Brevo; CloudTrail data events provavelmente inexistentes (§5) |
| 3. Identidade e permissões (15) | A — 2 contas sem 2FA no Workspace, administradores e recuperação | ❌ | ❌ | ❌ | Sem acesso ao Admin Console |
| | B — acessos Railway/GitHub/Google, apps OAuth, contas de serviço, escopos | ❌ | ❌ | ❌ | Railway/GitHub lidos; Google não. Código pronto para contas MySQL mínimas e workflows `contents: read` — não aplicado em ambiente |
| 4. Segurança do LiciGov (20) | A — GitGuardian + auditoria de dependências com correção ou descarte fundamentado | ✅ | ❌ | ❌ | GitGuardian: real, rotacionado em 21/09. Deps 38→14; **`xlsx` aplicável ainda aberto** (PR separada em andamento) |
| | B — autorização, isolamento, proteção de dados e replay nos caminhos afetados | ✅ | ✅ | ⏳ | Correlation id, backup sem cifra (proteção de dados), contas por função; smokes de isolamento e de menor privilégio. Valida com a CI do novo head |
| 5. IA e OAuth (10) | A — Gemini por SDK/modelo, só caminhos afetados, com testes | ✅ | ✅ | ✅ | `bf7180d` + testes; CI verde no head `4d99bee`. Não validado em staging |
| | B — aplicabilidade OAuth/MCP concluída ou não aplicabilidade fundamentada | ✅ | ✅ | ✅ | Aviso cita só `sincrosaude-creative-agent`; LiciGov sem OAuth Google/MCP Workspace |
| 6. Confirmações operacionais (5) | A — Google Cloud do LiciGov e Workspace ativos e faturamento regular | ❌ | ❌ | ❌ | **Reaberto**: recibo Railway não comprova Google; e-mails de 01/10 e 08/10 sem regularização posterior; sem console |
| | B — encerramento/transferência formal da frente SincroSaúde, sem bloqueio compartilhado | ❌ | ❌ | ❌ | Dependências mapeadas (Brevo, conta Google); sem evidência de encerramento |
| 7. Validação e encerramento (10) | A — build, tipos, lint, testes e verificação controlada do ambiente aprovado; sem regressão | ✅ | ✅ | ❌ | Local + CI; falta verificação em staging |
| | B — evidências sanitizadas, observabilidade validada, registro de mudanças, plano de recuperação; nenhum crítico/alto aberto | ❌ | ❌ | ❌ | P0 de credenciais aberto |

⏳ = depende da CI do novo head (ver `AUDIT_REPORT.md` §8). Só conta depois de verde.

## Pontuação (original)

| Leitura | Pontos | Critérios |
|---|---:|---|
| Auditado | **75 / 100** | 1A, 1B, 2A, 2B, 4A, 4B, 5A, 5B, 7A |
| Implementado | **35 / 100** | 1A, 1B, 4B, 5A, 5B, 7A |
| Validado (docs/testes/CI) | **30 / 100** se a CI do novo head ficar verde (senão 20) | 1A, 1B, 4B, 5A, 5B |
| Validado em ambiente aprovado / provedor | **0 / 100** em credenciais (0/30), identidade (0/15) e confirmações (0/5) | — |

Credenciais seguem **0/30** até atestação válida no console. `vol-screener` confirmado legítimo pelo Owner
(encerra só a suspeita pela data; não a revisão de consumo/logs).

## Rastreio da matriz reconstruída v1 (não equivalente ao original)

| Leitura | v1 publicada | Ajuste da revisão | v1 corrigida |
|---|---:|---|---:|
| Auditado | 85 | −2,5 (6.1 faturamento creditado pelo recibo Railway — indevido para Google) | 82,5 |
| Implementado | 37,5 | −2,5 (idem) | 35 |
| Validado | 27,5 | −2,5 (idem) +5 (7.1: CI verde no head `4d99bee`) | 30 |

Diferença para o original: a v1 contava como auditados critérios de identidade (3.2) e dependências (4.2) com
outra redação; o original exige revisão Google (3B) e correção ou descarte de todos os achados de dependência
(4A), ainda não atendidos.
