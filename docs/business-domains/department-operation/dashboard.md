# Área 1 — Centro de Operações (Dashboard)

> Tela inicial do `DepartmentOperationCenter`. Consolida **automaticamente** o estado
> operacional do departamento em uma única visão, sem duplicar dados dos Business Domains.

## Propósito

Responder, em segundos, à pergunta que o departamento faz todo dia:
**"Onde estamos e o que precisa de atenção agora?"**

Toda a informação é resolvida **por referência** via Kernel Access Service. O dashboard
nunca armazena cópias — apenas agrega e apresenta.

## Blocos consolidados automaticamente

O Centro de Operações reúne, em tempo real:

- **Processos licitatórios** ativos e concluídos.
- **Contratações diretas** (dispensa, inexigibilidade, credenciamento).
- **Contratos** vigentes e **aditivos**.
- **Pareceres** jurídicos, com destaque para os que aguardam ação.
- **Solicitações institucionais** (Institutional Request Engine) pendentes.
- **Contratos e aditivos próximos do vencimento** (janelas de 90/60/30/15/7 dias).
- **Tarefas** do departamento.
- **Eventos de hoje** e **eventos futuros** (do Calendário Operacional).
- **Recomendações** do Adaptive Recommendation Engine.

## Indicadores operacionais

Os indicadores são **estritamente operacionais**. **NUNCA financeiros.**

| Indicador | Origem (por referência) |
|---|---|
| Processos ativos | Processo Licitatório + Contratação Direta |
| Processos concluídos | Processo Licitatório + Contratação Direta |
| Pareceres aguardando | Parecer Jurídico |
| Contratos ativos | Contratos |
| Contratos vencendo | Contratos (janelas de alerta) |
| Aditivos | Contratos / Aditivos |
| Tarefas pendentes | Tarefas + OperationRecord |
| Solicitações pendentes | Institutional Request Engine |

### Proibições explícitas

**NUNCA** exibir: valores contratados, economia gerada, saldo orçamentário, empenho,
liquidação, pagamento, custo por processo ou qualquer métrica monetária. Se um dado
financeiro existir em outro domínio, ele **não é consultado nem exibido** aqui.

## Recomendações no dashboard

O bloco de recomendações vem do **Adaptive Recommendation Engine** e cobre priorização,
gargalos, riscos, sobrecarga e próximos vencimentos. Cada recomendação exibe:

- `reasoning` — por que foi sugerida;
- `confidence` — grau de certeza;
- `legalBasis` — fundamento legal (Lei 14.133/2021) quando existir;
- `impact` — efeito esperado;
- **alternativas** — sempre que houver mais de um caminho.

O **servidor sempre decide** o conteúdo; o cliente apenas apresenta. Ver `recommendations.md`.

## Eventos de hoje e futuros

O dashboard mostra um recorte do Calendário Operacional (Área 3): eventos de **hoje** e os
**próximos**. Clicar em um evento abre o processo relacionado. Publicações, checklists, TRs,
editais e pareceres **não** aparecem aqui — pertencem ao workflow, não ao calendário.

## Consolidação replay-safe

A agregação é **idempotente**: reprocessar as fontes não gera indicadores inflados nem
eventos duplicados, porque todos os identificadores derivam de `sha256` determinístico.
Isolamento **multi-tenant** garante que cada departamento vê apenas seus próprios dados.

## Relação com as demais áreas

O dashboard é a porta de entrada; cada bloco é um atalho para a área especializada:

- Linha de contratação → **Painel de Acompanhamento** (Área 2)
- Evento → **Calendário Operacional** (Área 3)
- "O que aconteceu" → **Timeline Operacional** (Área 4)
- "O que é meu" → **Minha Caixa de Entrada** (Área 5)
