# Preparação do Edital — prontidão primeiro (UX)

Escopo: **somente apresentação/orquestração**. Nenhuma autoridade, matriz, schema, catálogo, M1/M2, CAS ou idempotência mudou.
A prontidão é um *view-model puro* (`client/src/lib/editalReadiness.ts`) derivado do estado que a rota existente `editalTemplatePreparation`
já entrega — não existe segunda engine de prontidão nem estado persistido novo.

## Progressão (uma tela)
1. **TR oficial exato** (`TR_OFFICIAL_EXACT_REQUIRED` enquanto não houver pin válido; nunca "último"/rascunho/heurística).
2. **Configuração única do órgão** (só o que ESTE Edital exige).
3. **Dados na origem** (cadastro, Perfil da plataforma, Itens, Pesquisa de Preços, unidade requisitante, parâmetros do TR) — com ação direta (navegação, nunca escrita).
4. **Decisões deste certame** — recolhidas por padrão enquanto 1–3 bloqueiam (`aria-expanded`), abertas quando as fontes estão prontas.
   A pessoa pode abrir a qualquer momento (a escolha manual vence o padrão). Recolher não esconde informação: o conteúdo permanece no DOM.

Ordem da página: contexto → modelo aplicado → prontidão → origem/configuração → decisões → dados reaproveitados → detalhes técnicos → documento.

## Vocabulário único (superfície principal)
| Contador | Definição (sem dupla contagem) |
|---|---|
| `AUTO_RESOLVED_TOTAL` | campos com valor efetivo já disponível (cadastro/processo/DFD/ETP/itens/pesquisa/TR/perfil/plataforma/padrões/cronograma derivado). **Não** conta condicionais ocultos, pós-homologação, campos do sistema atribuídos só na emissão, nem decisões humanas do certame. |
| `ORIGIN_ACTION_REQUIRED_TOTAL` | informações que NÃO se digitam no Edital e precisam ser corrigidas na origem (+ TR oficial, se não selecionado; + parâmetros do TR a confirmar, se o TR é válido). |
| `ONE_TIME_CONFIGURATION_REQUIRED_TOTAL` | itens do Perfil institucional **necessários a este Edital** (`REQUIRED_FOR_CURRENT_DOCUMENT`). Campos adicionais do Perfil (`PROFILE_GLOBAL_INCOMPLETE`) só aparecem nos detalhes. |
| `PROCESS_DECISIONS_TOTAL` | campos **editáveis** do certame atual (CertameConfig/Cronograma + condicionais ativos), pendentes (ao vivo). |

Invariante verificado contra o MySQL real: `AUTO_RESOLVED_TOTAL + systemAtIssuance = summary.reusedAutomatically` do servidor, e
`PROCESS_DECISIONS_TOTAL = metrics.TRUE_NEW_DECISIONS_VISIBLE`.

## CTA
Com pendências: **"Resolver pendências"** lidera (âncora para a prontidão) e "Gerar edital com modelo institucional" existe, desabilitado, com o motivo
visível (`aria-describedby`). Com prontidão completa e preflight READY, a geração assume o protagonismo. O backend segue fail closed.
