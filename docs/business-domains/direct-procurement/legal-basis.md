# Fundamento Legal — Dispensa e Inexigibilidade

## Base normativa

A Contratação Direta apoia-se em dois artigos da Lei 14.133/2021:

- **Art. 74 — Inexigibilidade de licitação**: aplicável quando é **inviável a
  competição** (fornecedor exclusivo, serviços técnicos especializados de
  natureza singular com profissional de notória especialização, credenciamento,
  aquisição/locação de imóvel específico, entre outros).
- **Art. 75 — Dispensa de licitação**: hipóteses em que a licitação é
  **dispensável** (baixo valor, emergência, licitação deserta/fracassada,
  contratações remanescentes etc.).

A etapa `LEGAL_BASIS` da máquina de estados é onde o operador seleciona o
fundamento aplicável.

## Seleção do fundamento

A operação `selectLegalBasis` (router `directProcurement`) registra:

- o **artigo** e o **inciso** aplicáveis (ex.: Art. 75, II);
- a **modalidade** derivada (Dispensa ou Inexigibilidade);
- uma **justificativa** textual do enquadramento.

A seleção do fundamento **define a modalidade**, que por sua vez alimenta o
Adaptive Process Engine (ver `workflow.md`) — determinando, por exemplo, se
pesquisa de preços e recebimento de propostas serão obrigatórios.

## Recomendação assistida

O copiloto `juridico` pode **sugerir** o enquadramento a partir da caracterização
da necessidade. Como toda recomendação do domínio, ela carrega:

- **reasoning** — por que aquele artigo/inciso foi sugerido;
- **explainability** — os elementos da demanda que sustentam o enquadramento;
- **provenance** — a origem da inferência;
- **confidence** — o grau de confiança.

A sugestão é sempre **rejeitável**. A decisão final é do operador humano.

## Alteração do fundamento

O fundamento pode ser **alterado** a qualquer momento antes da ratificação.
Ao mudar de Dispensa para Inexigibilidade (ou vice-versa):

1. a modalidade é reavaliada;
2. o Adaptive Process Engine recalcula quais etapas são obrigatórias, opcionais
   ou puladas;
3. o Timeline Engine registra a alteração com a razão.

Exemplo: mudar de Art. 74 (inexigibilidade) para Art. 75 (dispensa) pode
**reintroduzir** as etapas `PRICE_RESEARCH` e `PROPOSAL_COLLECTION`, antes
opcionais.

## Princípio: nunca bloqueia

O sistema **nunca bloqueia** o operador por causa do fundamento legal. Ele:

- **orienta** com recomendações explicáveis;
- **alerta** sobre inconsistências (ex.: dispensa por valor acima do limite);
- **registra** a justificativa para rastreabilidade;

mas **não impede** o avanço. A responsabilidade pelo enquadramento é da autoridade
competente, e o papel do LiciGov Pro é dar segurança jurídica e rastreabilidade,
não substituir a decisão. Todo alerta é informativo e auditável, jamais um
impeditivo rígido.

## Rastreabilidade

Cada seleção ou alteração de fundamento gera um registro no Timeline Engine
(`process_timeline`), preservando o histórico completo de enquadramentos do
processo — essencial para auditoria e para a instrução processual.
