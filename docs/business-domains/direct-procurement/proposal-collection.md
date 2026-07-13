# Recebimento de Propostas

## Visão geral

A etapa `PROPOSAL_COLLECTION` gerencia o **recebimento de propostas** de
fornecedores na contratação direta. Ela é **obrigatória para dispensa** e
**opcional para inexigibilidade** (ver `workflow.md`), e é decidida pelo Adaptive
Process Engine.

Os dados são persistidos em duas tabelas:

- `proposal_collections` — a coleta de propostas do workspace;
- `proposal_documents` — os documentos anexados a cada proposta.

## Cadastro de fornecedores

Antes de registrar propostas, os **fornecedores** são cadastrados na coleta.
Para cada fornecedor registram-se os dados de identificação (razão social, CNPJ,
contato). O cadastro é multi-tenant (`organizationId`) e serve de base para
vincular propostas e documentos.

## Registro de propostas

A operação `registerProposal` (router `directProcurement`) registra a proposta de
um fornecedor, contendo:

- referência ao fornecedor;
- valor proposto;
- objeto/itens ofertados;
- observações;
- documentos anexos (por referência — ver abaixo).

O registro é **manual**: o operador insere a proposta recebida pelo canal
definido na etapa `PROCEDURE` (plataforma eletrônica ou recebimento presencial).

## Anexos por referência

Princípio central: **anexos são armazenados por REFERÊNCIA, nunca por cópia**.

- o documento reside no seu local canônico (Storage/S3, Document Engine);
- `proposal_documents` guarda a **referência** (chave/ID) ao artefato;
- nenhuma duplicação binária é feita dentro do domínio de propostas.

Benefícios: consistência (uma única fonte de verdade), economia de armazenamento,
rastreabilidade e alinhamento com o princípio de **reutilizar sem duplicar** que
rege todo o domínio.

## Sem envio automático

O módulo **não realiza envio automático** de convites, e-mails ou notificações a
fornecedores. O recebimento é operado manualmente pelo usuário. O envio
automático de convites e a integração de e-mail são **Future Evolution** — existem
apenas pontos de extensão, não implementação (ver `roadmap.md`).

Da mesma forma, **não há leitura automática** de propostas: a inserção dos dados é
sempre feita ou revisada por um humano.

## Recomendação assistida

O copiloto `agente_contratacao` pode apoiar a organização das propostas (por
exemplo, apontar propostas incompletas ou destacar a de menor valor). Como toda
recomendação do domínio, ela traz **reasoning**, **explainability**,
**provenance** e **confidence**, e é sempre **rejeitável** pelo operador.

## Determinismo

IDs de coletas, propostas e documentos são derivados de `sha256` sobre entradas
estáveis — sem `Date.now()` nem `Math.random()`. O recebimento é **replay-safe**:
reprocessar a mesma sequência de registros produz o mesmo estado.
