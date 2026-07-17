# Official Knowledge Corpus — Federal + Paraná + Moreira Sales (RC-4.9)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> Esta RC **não cria frameworks** — utiliza exclusivamente a infraestrutura cognitiva já existente
> (Knowledge Framework, Pipeline, Normative Foundation, Corpus) para **popular** o sistema com o
> primeiro **Corpus Oficial** institucional, a partir de **texto oficial verbatim**. **NÃO** implementa
> RAG, chat ou IA; **não** resume, interpreta ou comenta. Multi-tenant, replay-safe, auditável.

## O que é

Primeiro conhecimento institucional oficial do LiciGov Pro, incorporado a partir de fontes oficiais
reais versionadas no repositório (`data/`), passando integralmente pelo **Institutional Knowledge
Pipeline**. Escopo de validação da arquitetura antes da expansão: **Federal**, **Paraná** e
**Moreira Sales/PR**.

```
data/*.txt (texto oficial)
   → parseOfficialText (verbatim, determinístico)
   → KnowledgeDocument (OfficialTextBlock por artigo + Explainability de origem)
   → Institutional Knowledge Pipeline (16 estágios + quality gates + publicação)
   → OfficialDocument (classificação Fase 5) + Corpus (Federal→Estado→Município)
```

## Componentes

| Fase | Componente | Arquivo | Papel |
|---|---|---|---|
| 1-4 | **Parser oficial** | `server/services/officialCorpus/officialTextParser.ts` | Converte texto oficial em segmentos/artigos VERBATIM (determinístico). |
| 1-4 | **Ingestão** | `server/domain/officialCorpus/officialCorpusIngestion.ts` | Monta KnowledgeDocument, roda o Pipeline com perfil oficial e publica; opcionalmente constrói a árvore normativa. |
| 5 | **Classificação** | `server/domain/officialCorpus/officialDocument.ts` | documentId, documentType, authority, jurisdiction, scope, tenantId, state, municipality, effectiveDate, source, version, status, language. |
| 6/8 | **Registro/Resolução/Consultas** | `server/domain/officialCorpus/officialCorpusRegistry.ts` | Corpora Federal→Paraná→Moreira Sales; consultas (esfera/autoridade/estado/município/tipo/vigência/tenant); resolução hierárquica. |
| 1-4 | **Builder** | `server/services/officialCorpus/officialCorpusBuilder.ts` | Lê `data/` e incorpora as 3 esferas. |
| 10 | **Explainability** | `server/domain/officialCorpus/officialCorpusExplainability.ts` | Origem/classificação/vigência/pipeline/publicação. |
| 9 | **Observabilidade** | `server/services/knowledge/officialCorpusObservabilityService.ts` | corpusCreated, documentPublished, newVersion, updated, rollback por correlationId. |

## Documentos incorporados (texto oficial real)

| Esfera | Documento | Tipo | Autoridade | Fonte |
|---|---|---|---|---|
| **Federal** | **Lei nº 14.133/2021** (árvore normativa: 5 Títulos, 32 Capítulos, ~209 artigos) | lei | Congresso Nacional | planalto.gov.br |
| Federal | Decreto nº 11.462/2023 | decreto | Presidência da República | planalto.gov.br |
| Federal | IN SEGES/ME nº 65/2021 | instrucao_normativa | SEGES/ME | in.gov.br |
| Federal | LC nº 123/2006 | lei_complementar | Congresso Nacional | planalto.gov.br |
| Federal | Manual de Licitações e Contratos do TCU (5ª ed.) | manual | TCU | portal.tcu.gov.br |
| **Paraná** | Orientações Técnicas do TCE-PR | orientacao_tecnica | TCE-PR | tce.pr.gov.br |
| **Paraná** | **Prejulgado nº 27** *(RC-4.9.1)* | prejulgado | TCE-PR | tce.pr.gov.br |
| **Moreira Sales** | **Lei Municipal nº 769/2021** *(RC-4.9.1 — texto oficial via OCR do PDF fornecido)* | municipal_law | Município de Moreira Sales | Prefeitura de Moreira Sales |

### Expansão RC-4.9.1

Dois documentos oficiais **reais** foram incorporados pela mesma pipeline da RC-4.9 (parser →
classificação → validation → pipeline → publicação), **sem** qualquer novo framework/serviço:

- **Prejulgado nº 27 (TCE-PR):** `documentType: prejulgado`, `jurisdiction: estadual`, `state: PR`,
  `bindingLevel: prejulgado_tce`. Incorporado por trechos verbatim (25 páginas).
- **Lei Municipal nº 769/2021 (Moreira Sales):** `documentType: municipal_law`, `jurisdiction: municipal`,
  `state: PR`, `municipality: Moreira Sales`, `tenantId` municipal, `bindingLevel: mandatory`,
  vigência `2021-03-03`. Texto oficial extraído por **OCR** (PDF escaneado) e parseado em artigos
  (Art. 1º–10) → árvore normativa municipal.

Foi adicionado ao modelo de classificação um campo `bindingLevel` (mandatory / prejulgado_tce /
orientacao / referencia) e dois `documentType` (`prejulgado`, `municipal_law`) — **extensões aditivas**,
sem alterar a arquitetura.

**Nota (RC-4.9):** anteriormente Moreira Sales estava apenas **preparado** (0 documentos, sem fonte).
Com a RC-4.9.1, recebe seu **primeiro documento oficial real**. Nenhum conteúdo é fabricado — todo
texto provém das fontes fornecidas.

## Hierarquia e resolução (Fase 6)

Corpora encadeados **Federal → Paraná → Moreira Sales** (via `parentId`). `resolveContext` retorna os
documentos aplicáveis ordenados por esfera (**federal primeiro**): documentos estaduais e municipais
**complementam, nunca substituem** as normas federais.

## Quality Gates — perfil oficial (Fase 7)

O Institutional Knowledge Pipeline foi estendido de forma **aditiva e retrocompatível** com um perfil
`official_norm`: para documentos oficiais verbatim (sem resumos/interpretações), a cobertura é
satisfeita por **OfficialTextBlock + ExplainabilityBlock** (origem factual), em vez dos blocos
recomendados do perfil geral. O perfil padrão (`general`) permanece inalterado → **zero regressões**
na RC-4.8. Todo documento passa pelos 16 estágios e só é publicado se aprovado nos gates.

## Garantias

- **Verbatim / sem IA:** texto oficial preservado por artigo; nenhum resumo, interpretação ou comentário.
- **Replay Safety / Determinismo:** ids/replayHash via sha256 sobre o conteúdo; mesma fonte → mesma
  incorporação.
- **Multi-tenant:** documentos municipais carregam `tenantId`; federais/estaduais são compartilhados.
- **Auditabilidade / Explainability / Versionamento:** publicação imutável com checksum; toda operação
  observável.

## Garantias por teste (`rc49-official-knowledge-corpus.test.ts`, ORG 13500)

Parser verbatim (Lei 14.133 real), classificação + isolamento municipal, cadastro federal/estadual/
municipal (Moreira Sales com 0 documentos fabricados), hierarquia (cadeia de corpora), resolução por
tenant (federal precede, municipal complementa), pipeline (16 estágios + publicação), quality gates
(perfil oficial passa / perfil geral falha / sem resumos), conteúdo verbatim, consultas, explainability,
observabilidade, replay safety. **Zero regressões.**

## Resultado

O LiciGov Pro possui seu primeiro **Corpus Oficial** institucional, com documentos **reais**
exercitando toda a arquitetura cognitiva. Este é o **modelo de referência** para expansão a outros
estados e municípios — bastando adicionar novas fontes oficiais, sem alterar a arquitetura.
