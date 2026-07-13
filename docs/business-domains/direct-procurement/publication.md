# Publicação

## Visão geral

A etapa `PUBLICATION` gera os atos de **publicação** da contratação direta,
consolidando os dados do processo em documentos oficiais. A operação `publish`
(router `directProcurement`) produz a publicação, persistida na tabela
`generated_publications`.

A publicação é sempre precedida pela **Ratificação** (`RATIFICATION`), etapa em
que a autoridade competente registra responsável, decisão, justificativa e
evidências.

## Conteúdo gerado

Conforme a modalidade e o procedimento, a publicação pode incluir:

- **Aviso** — comunicação do ato de contratação direta;
- **Ratificação** — o ato ratificado pela autoridade competente;
- **Extrato** — extrato do contrato/ato para publicidade;
- **Instruções** — orientações de publicação (onde e como publicar);
- **Cronograma** — datas e prazos do processo de publicidade.

## Geração por modalidade e procedimento

O conteúdo é ajustado ao contexto:

| Fator | Efeito na publicação |
|---|---|
| **Dispensa (Art. 75)** | Aviso e extrato com fundamento da dispensa |
| **Inexigibilidade (Art. 74)** | Aviso e extrato com fundamento da inviabilidade de competição |
| **Eletrônico** | Instruções voltadas à plataforma utilizada |
| **Presencial** | Instruções voltadas ao veículo oficial do órgão |

O fundamento legal (ver `legal-basis.md`) e o procedimento (ver `procedures.md`)
alimentam o texto gerado.

## Document Engine

A geração dos documentos de publicação usa o **Document Engine** da plataforma —
nunca uma implementação própria de geração documental. Isso garante consistência
de formatação, versionamento e rastreabilidade com os demais documentos do
sistema.

Todos os artefatos gerados são:

- **editáveis** — o operador ajusta o texto antes de publicar;
- **revisáveis** — passam por validação humana obrigatória;
- **versionados** — cada geração fica registrada.

## Explicabilidade

Quando a IA propõe conteúdo de publicação, a recomendação carrega **reasoning**,
**explainability**, **provenance** e **confidence**, e é sempre **rejeitável**. A
IA estrutura o ato; a decisão de publicar é humana.

## Determinismo e rastreabilidade

As publicações recebem IDs derivados de `sha256`, sem `Date.now()` nem
`Math.random()`, mantendo o comportamento **replay-safe**. Cada publicação é
multi-tenant (`organizationId`) e registrada no Timeline Engine
(`process_timeline`), preservando o histórico completo do processo de publicidade.

## Limite de escopo

O LiciGov Pro **gera** os documentos de publicação; a **transmissão** automática a
veículos oficiais externos (ex.: Diário Oficial, PNCP) é **Future Evolution** —
existem apenas pontos de extensão, não integração ativa (ver `roadmap.md`).
