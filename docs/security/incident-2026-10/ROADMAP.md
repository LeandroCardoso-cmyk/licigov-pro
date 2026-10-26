# Roadmap de remediação — pontuação reconciliada

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
