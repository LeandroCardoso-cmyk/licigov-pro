# Decisão do Owner — Estratégia de produto e modelo comercial institucional (LICIGOV-LAUNCH-READY, 26/11/2026)

> Registro técnico de decisões **expressas pelo Owner** na missão de convergência LICIGOV-LAUNCH-READY. Complementa — sem
> substituir — a Constituição (`PRODUCT_NORTH_STAR.md`). Não cria regra estrutural além do que está escrito aqui.
> Decisão de produto da **plataforma** (governança da plataforma): não é ato administrativo de nenhum órgão.

## 1. Posicionamento (reafirmado)

O LiciGov Pro é a camada cognitiva e operacional das contratações públicas — não um ERP.

### Fora da estratégia do produto
- Publicação automatizada no PNCP.
- Publicação em plataformas de disputa.
- Aplicativos nativos Android/iOS.
- Banco de preços próprio ou integração comercial com bancos de preços.
- Checkout automatizado.
- Assinatura comercial individual por usuário.
- Gestão de empenho, liquidação e pagamento.
- Substituição de sistemas administrativos e contábeis.

### Permanece estratégico
- Consulta a fontes oficiais para fundamentação normativa e CATMAT/CATSER.
- Pesquisa de preços: importação, organização, análise, tratamento e proveniência das cotações (sem banco de preços próprio).
- Acesso multiplataforma por **web responsiva**, com evolução para **PWA** (não é bloqueador automático do lançamento).

## 2. Modelo comercial institucional

| Elemento | Decisão |
|---|---|
| Cliente contratante | Organização pública |
| Licenciamento | Por organização (`licensed_modules`; mutação só por admin de plataforma com tenant explícito e auditado) |
| Entrada comercial | Solicitação de proposta personalizada / demonstração (`/solicitar-proposta`) — manifestação de interesse, sem obrigação |
| Contratação | Procedimento administrativo legalmente aplicável ao órgão, **formalizado fora do LiciGov Pro** |
| Concessão de acesso | Administrativa: criação do órgão + convite do 1º administrador (`tenantOnboarding.create`) e, quando aplicável, licença por módulo |
| Vigência | Gestão administrativa da licença por organização |
| Usuários | Convite pelo administrador do órgão |

### Retirado da jornada comercial ativa (sem apagar código/tabelas/histórico Stripe)
- Checkout por usuário (`billing.createCheckoutSession` desativado — `LEGACY_ENDPOINT_DISABLED`, LR-07).
- "Assinar agora", teste gratuito automático de 30 dias, "SLA 98%" (página `/planos` redireciona para a proposta).
- Valores vindos exclusivamente de seeds não aprovados (a proposta não exibe nem grava preço — LR-02).
- Promessa automática de liberação em 48h e orientação automática de empenho (COM-01).
- Ativação de "assinatura" a partir da proposta (`commercial.activateSubscription` desativado — LR-03).

Não foram definidos preços, não foi criado motor de pagamentos nem ERP comercial.

## 3. Inconsistências identificadas (para alinhamento do Owner — NÃO alteradas aqui)

| Documento | Trecho | Situação |
|---|---|---|
| `roadmap/PRODUCT_ROADMAP.md` (P2) | "Integrações adicionais (PNCP, CATMAT/CATSER ampliado, assinatura digital)" | PNCP como **publicação automatizada** saiu da estratégia; CATMAT/CATSER permanece. Ajustar redação. |
| `roadmap/PRODUCT_ROADMAP.md` (Sprint 7) | "PNCP, ComprasNet, Diário Oficial Eletrônico, SIAFI/SIAPE" | Publicação/integração com sistemas administrativos e contábeis fora da estratégia; manter só consulta a fontes oficiais. |
| `roadmap/PRODUCT_ROADMAP.md` (Sprint 8) | "App mobile para revisão de documentos" | Substituir por web responsiva + PWA. |
| `PRODUCT_NORTH_STAR.md` | "PNCP é padrão" (registro de publicação por canal) | Compatível se entendido como **registro declarado** de status/data (como `publicationRecord`), não publicação automatizada. Recomenda-se nota explícita na próxima revisão da Constituição. |
| `PRODUCT_NORTH_STAR.md` | Integrações de calendário incluem "Mobile" | Ler como acesso por dispositivo móvel via web/PWA. |
| `CLAUDE.md` (Stack) | "Billing: Stripe (billingRouter)" | Stripe permanece como código legado preservado; checkout por usuário desativado. |
| `client/src/components/landing/PricingPlans.tsx` | componente de planos | Não referenciado por nenhuma rota/página (código morto); não renderiza. |

## 4. Rastreabilidade
Implementação: PR LeandroCardoso-cmyk/licigov-pro#357 (branch `launch-ready/product-remediation`), pacotes LR-02, LR-03, LR-07,
LR-08. Handoff: `docs/handoffs/LAUNCH_READY_LANE_B_HANDOFF.md`.
