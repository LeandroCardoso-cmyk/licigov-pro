# Roadmap de remediação — incidente Railway (out/2026)

> **Versão dos critérios: v1-reconstruída (25/10/2026).** O `ROADMAP.md` mencionado no pedido da auditoria
> não está no repositório nem foi anexado; os critérios abaixo foram reconstruídos de forma explícita, com os
> pesos de fase pedidos e **dois critérios de igual peso por fase**. Se o ROADMAP original aparecer, comparar
> e versionar (v2) antes de repontuar.

## Regras de pontuação

- Só pontua critério **comprovado** por evidência citada; nada de percentual inicial inventado.
- Três leituras por critério: **Auditado** (avaliação feita com evidência), **Implementado** (correção pronta
  no código/documento/console) e **Validado em ambiente** (comprovado no ambiente real — staging/produção ou,
  para testes, CI/banco isolado declarado).
- Critério sem acesso fica **pendente**. "Não aplicável" só com evidência.
- Com P0/P1 relevante aberto ou ação operacional obrigatória pendente, o total **não** chega a 100%.

## Critérios e estado (25/10/2026)

| Fase (peso) | Critério (peso) | Auditado | Implementado | Validado | Evidência / pendência |
|---|---|:-:|:-:|:-:|---|
| 1. Auditoria e inventário (10) | 1.1 Inventário sanitizado de ativos/credenciais por ambiente, com consumidores (5) | ✅ | ✅ | ✅ | `CREDENTIAL_INVENTORY.md` (Railway MCP, workflows, código) |
| | 1.2 Triagem dos alertas (Railway, GitGuardian, Gemini, OAuth, deps, logs) com matriz P0–P3 (5) | ✅ | ✅ | ✅ | `AUDIT_REPORT.md` §2–§4 |
| 2. Credenciais (30) | 2.1 Credenciais potencialmente expostas rotacionadas e validadas (prod e staging) (15) | ✅ | ❌ | ❌ | Rotação pós-incidente não comprovada para DB, Gemini, AWS, Brevo, JWT → `ROTATION_RUNBOOK.md` |
| | 2.2 Anteriores revogadas no emissor, consumidores secundários atualizados, segredos sem consumidor removidos (15) | ✅ | ❌ | ❌ | Código permite remover `ADMIN_PASSWORD`; remoção no Railway e revogações dependem do Owner |
| 3. Identidade e permissões (15) | 3.1 2FA confirmado em todas as contas com acesso (Railway, GitHub, Google, AWS, Brevo; 2 usuários do Workspace `sincrosaude.com.br`) (7,5) | ❌ | ❌ | ❌ | Sem acesso aos consoles de identidade |
| | 3.2 Menor privilégio: usuário de banco dedicado (app/backup), workflows com `contents: read`, tokens Railway revisados, senha do admin de plataforma trocada (7,5) | ✅ | ⚠️ parcial | ❌ | Workflows corrigidos (commit `469b735`); DB/tokens/admin pendentes |
| 4. Segurança da aplicação (20) | 4.1 Isolamento multi-tenant, RBAC e sessão sem regressão (smokes de segurança executados) (10) | ✅ | ✅ | ✅ (banco isolado) | `pnpm test:smoke:security` em MySQL local sintético; CI na PR |
| | 4.2 Nenhuma high/critical aplicável aberta em deps de produção; gate fail-closed (10) | ✅ | ⚠️ parcial | ❌ | Gate fail-closed + remoção de deps mortas; restam `xlsx` (aplicável), `drizzle-orm`, `fast-xml-parser`, etc. |
| 5. IA/OAuth (10) | 5.1 Parâmetros Gemini compatíveis (sem `thinking_budget`/sampling em 3.x), com teste (5) | ✅ | ✅ | ❌ | Unit tests; validação em staging após deploy |
| | 5.2 OAuth/MCP: proprietário e clientes identificados; aplicabilidade ao LiciGov comprovada (5) | ✅ | ✅ | ✅ | Aviso lista só `sincrosaude-creative-agent`; LiciGov sem OAuth Google — não aplicável com evidência |
| 6. Confirmações operacionais (5) | 6.1 Faturamento regularizado com evidência (2,5) | ✅ | ✅ | ✅ | Recibo Railway #2157-7829 (25/10) |
| | 6.2 Recursos do workspace reconhecidos e consumo/logs dos provedores revisados (2,5) | ⚠️ | ❌ | ❌ | `vol-screener` a confirmar; consumo Gemini/AWS/Brevo sem acesso |
| 7. Validação e encerramento (10) | 7.1 check, lint, test, build, audit:gate e smokes verdes no branch e na CI (5) | ✅ | ✅ | ❌ | Local verde (relatório §8); CI da PR pendente |
| | 7.2 Correções implantadas staging → produção e atestação operacional registrada (5) | ❌ | ❌ | ❌ | Depende de merge/deploy e do Owner |

## Pontuação comprovada

Contagem: critério cheio = peso; "parcial" **não** pontua (regra conservadora).

| Leitura | Pontos | Critérios que contam |
|---|---:|---|
| **Auditado** | **85 / 100** | 1.1, 1.2, 2.1, 2.2, 3.2, 4.1, 4.2, 5.1, 5.2, 6.1, 7.1 (5+5+15+15+7,5+10+10+5+5+2,5+5) |
| **Implementado** | **37,5 / 100** | 1.1, 1.2, 4.1, 5.1, 5.2, 6.1, 7.1 (5+5+10+5+5+2,5+5) |
| **Validado em ambiente** | **27,5 / 100** | 1.1, 1.2, 4.1 (banco isolado), 5.2, 6.1 (5+5+10+5+2,5) |

Créditos de correções anteriores verificadas: isolamento/RBAC/sessão (PR 0, PR A, NEW-005/006, LEG-028 —
comprovados pelos smokes executados nesta sessão) e rotação do `JWT_SECRET` de 21/09 (atestação G5), que **não**
pontua em 2.1 por ser anterior ao incidente.

O maior bloco pendente é **Credenciais (30 pontos)**, inteiramente dependente de ação do Owner nos consoles.
