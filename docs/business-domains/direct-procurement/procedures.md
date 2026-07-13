# Procedimentos — Eletrônico e Presencial

## Visão geral

A etapa `PROCEDURE` define **como** a contratação direta será operacionalizada:
por meio **eletrônico** (plataforma) ou **presencial** (recebimento manual). A
configuração é feita pela operação `configureProcedure` do router
`directProcurement` e persistida na tabela `direct_procurement_procedures`.

O procedimento escolhido influencia a etapa `PROPOSAL_COLLECTION` (ver
`proposal-collection.md`), determinando os canais de recebimento de propostas.

## Procedimento eletrônico

Utilizado quando a coleta ocorre por uma plataforma de compras. Plataformas
suportadas:

| Plataforma | Uso típico |
|---|---|
| **Compras.gov.br** | Portal federal de compras públicas |
| **BLL** | Bolsa de Licitações e Leilões |
| **Licitanet** | Plataforma privada de licitações |
| **Portal Próprio** | Portal do próprio órgão |
| **Outra** | Qualquer plataforma não listada (campo livre) |

Para o procedimento eletrônico registram-se:

- a plataforma selecionada;
- identificador/URL do processo na plataforma (quando aplicável);
- observações operacionais.

> Importante: o LiciGov Pro **não** é uma plataforma de pregão eletrônico. Ele
> **registra e referencia** o procedimento realizado na plataforma externa, sem
> substituí-la. Não há envio automático de convites nesta fase (ver `roadmap.md`).

## Procedimento presencial

Utilizado quando as propostas são recebidas fora de plataforma. Formas de
recebimento suportadas:

| Forma de recebimento | Descrição |
|---|---|
| **E-mail** | Propostas recebidas por correio eletrônico |
| **Protocolo** | Entrada via protocolo do órgão |
| **Entrega presencial** | Entrega física no setor |
| **Outro** | Qualquer outra forma (campo livre) |

Para o procedimento presencial registram-se a forma de recebimento e as
instruções operacionais correspondentes.

## Templates

Cada combinação de modalidade × procedimento pode gerar **templates** de apoio
via Document Engine — por exemplo, instruções de participação, roteiro de
recebimento ou minuta de aviso. Os templates são:

- **editáveis** — o operador ajusta o texto gerado;
- **revisáveis** — passam por validação humana;
- **rastreáveis** — versionados e registrados na timeline.

## Recomendação assistida

O copiloto `agente_contratacao` pode sugerir o procedimento mais adequado com base
na modalidade, no valor estimado e no histórico do órgão. A sugestão carrega
**reasoning**, **explainability**, **provenance** e **confidence**, e é sempre
**rejeitável**.

## Persistência e determinismo

A configuração do procedimento é persistida com `organizationId` (multi-tenant) e
IDs derivados de `sha256`. Não há uso de `Date.now()` nem `Math.random()`,
mantendo o comportamento **replay-safe**.
