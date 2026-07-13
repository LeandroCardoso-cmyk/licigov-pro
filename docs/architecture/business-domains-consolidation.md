# Consolidação Arquitetural dos Business Domains (Sprint 5.X.X)

> O LiciGov Pro é uma **camada cognitiva e operacional do departamento de licitações**.
> Não é um ERP. Não decide. Não obriga. Não executa atos administrativos.

## Objetivo do sistema

- Reduzir tempo operacional
- Aumentar a qualidade documental
- Aumentar a segurança jurídica
- Padronizar procedimentos
- Orientar o servidor
- Produzir documentos robustos

## Princípio fundamental

O sistema apenas **analisa, recomenda, fundamenta, explica e apresenta alternativas**.
Toda decisão permanece do **servidor**. Vale para **todos** os Business Domains, sem exceção.

Codificado em `server/domain/domainPhilosophy.ts`:
- `SYSTEM_CAPABILITIES` = analisar, recomendar, fundamentar, explicar, apresentar_alternativas
- `SYSTEM_NON_CAPABILITIES` = decidir, obrigar, executar_atos_administrativos

## Regra de Ouro

Toda funcionalidade deve responder **SIM** a:

1. Reduz tempo operacional?
2. Melhora a qualidade documental?
3. Aumenta a segurança jurídica?
4. Produz documentos oficiais ou participa diretamente da produção documental?
5. Pertence ao departamento de licitações?

E **NÃO** à pergunta de ERP (pagamentos, financeiro, empenhos, patrimônio, almoxarifado,
folha, execução orçamentária, controle financeiro). Se for típica de ERP → **remover**.

Avaliação determinística em `evaluateFeature()` → `keep` | `future_evolution` | `remove`.
Guarda `assertNotErp()` / `isErpConcern()` barram capacidades fora de escopo.

## Adaptive Recommendation Engine

`server/domain/adaptiveRecommendationEngine.ts` substitui a filosofia de "decisão" por
**recomendação orientadora**. Para cada etapa (DFD, ETP, Pesquisa de Preços, TR, Edital,
Parecer, Aditivo, Apostilamento, Publicação, Proposta) produz:

- `recommended` (sim/não — **nunca** obrigação)
- `reasoning` (motivos)
- `legalBasis` (base legal — Lei 14.133/2021)
- `confidence` (nível de confiança 0–1)
- `options` (alternativas)
- `allowDecline: true` + `requiresJustificationOnDecline`

O servidor **sempre** escolhe. Recusar **nunca** bloqueia o fluxo — apenas registra a
escolha e (opcionalmente) a justificativa. Endpoint reutilizável:
`trpc.adaptiveRecommendation.recommend` / `.decide`.

### Exemplo (ETP)

Em vez de "Necessita ETP? → Sim", o sistema apresenta a **Análise da Contratação**:
recomenda elaborar o ETP, com motivos, base legal (art. 18) e nível de confiança, e
oferece as opções *Elaborar* / *Não elaborar*. Ao não elaborar, permite justificar.

## Documentos oficiais: sempre DOCX + PDF

`server/domain/documentFormats.ts` consolida que todo documento produzido **na plataforma**
gera **DOCX e PDF** (`REQUIRED_OFFICIAL_FORMATS`). Infra de renderização já existente
(`documentRenderService`, libs `docx`/`jspdf`/`pdfkit`).

| Domínio | Documentos oficiais |
|---|---|
| Processo Licitatório | DFD, ETP (quando elaborado), TR, Edital |
| Contratação Direta | Justificativas, Aviso, Ratificação, Extrato |
| Parecer Jurídico | Parecer |
| Contratos | Contrato, Aditivo, Apostilamento, Rescisão |

## Filosofia por domínio (consolidada)

- **Processo Licitatório** — DFD gera documento; ETP nunca obrigatório (recomendado);
  TR e Edital sempre; zero comportamento de ERP.
- **Contratação Direta** — parecer/pesquisa/procedimento apenas recomendados; foco documental.
- **Parecer Jurídico** — fluxo enxuto: Caixa → Receber → Analisar → Produzir → Assinar → Responder.
- **Contratos** — contratos/aditivos/apostilamentos/rescisões; ocorrências = histórico simples.

## Future Evolution

Mover para Future Evolution tudo que não é necessário para produção. Preparar apenas
interfaces, feature flags, hooks e pontos de extensão.
