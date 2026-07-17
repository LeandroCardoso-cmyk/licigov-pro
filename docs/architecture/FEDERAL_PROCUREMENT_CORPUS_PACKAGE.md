# Federal Procurement Corpus Package (RC-4.6)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> ⚠️ **Esta RC NÃO adiciona conteúdo jurídico.** Não contém artigos, incisos, parágrafos, a Lei
> 14.133 detalhada, acórdãos, doutrina nem jurisprudência. Não conecta LLM, Providers, Business
> Domains ou UX. Ela cria apenas o **primeiro pacote institucional instalável** do sistema —
> a **estrutura** do Corpus Federal de Licitações. Multi-tenant, determinística, replay-safe.

## O que é

As RCs anteriores construíram toda a infraestrutura cognitiva permanente (Operating Model,
Legal Ontology, Ontology Integration, Legal Knowledge Foundation, Institutional Corpus Framework).
A RC-4.6 cria o **primeiro pacote oficial de conhecimento**: o **Federal Procurement Corpus**,
tratado como uma **unidade institucional independente e instalável** — ainda **sem** conteúdo.

```
CorpusPackage → CorpusManifest + CollectionManifest[] (vazias) + Integrity/Checksums + Lifecycle
```

Vive em `server/domain/corpus/package/`.

## Componentes

| Componente | Arquivo | Papel |
|---|---|---|
| **CorpusManifest** | `corpusManifest.ts` | Representa oficialmente um Corpus (id, name, description, authority, jurisdiction, language, scope, version, compatibility, dependencies, collections, metadata, replayHash). |
| **CollectionManifest** | `collectionManifest.ts` | Descreve uma coleção (id, name, description, category, version, authority, dependencies, knowledgeUnits). **`knowledgeUnits` sempre vazio nesta RC.** |
| **Federal Collections** | `federalCollections.ts` | As 5 coleções oficiais **vazias**: Lei 14.133, Decretos, IN SEGES, AGU, TCU. |
| **CorpusPackage** | `corpusPackage.ts` | Pacote instalável: manifest + coleções + knowledge units (vazias) + version + **integrity/checksums** + **replayHash** + **lifecycle** (draft → registered → validated → active → deprecated). |
| **Federal Procurement Corpus** | `federalProcurementCorpus.ts` | O primeiro pacote oficial (`buildFederalProcurementCorpus`). Autoridade "Governo Federal", jurisdição federal, escopo união, v1.0.0. |
| **Package Registry** | `corpusPackageRegistry.ts` | Registro declarativo de pacotes — registra o Federal Procurement Corpus (sem instalação). |
| **Package Validation** | `packageValidation.ts` | Valida Manifest, Dependencies, Collections, Replay Hash, Checksums, Version — **sem instalação**. |
| **Package Projection** | `packageProjection.ts` | Projeta Corpus Package node + Collection Nodes + Package Dependencies para o Knowledge Graph. |
| **Queries** | `packageQueries.ts` | `findPackage`, `findCollections`, `findManifest`, `findDependencies`, `findCompatibility`, `findVersions`, `findAuthority`, `findScope`. |
| **Explainability** | `packageExplainability.ts` | `explainPackage()`: origem, autoridade, versão, escopo, coleções, dependências, compatibilidade, integridade. |
| **Semver** | `semver.ts` | Comparação/faixas de versão mínimas (determinístico, sem dependências). |
| **Observabilidade** | `server/services/knowledge/corpusPackageObservabilityService.ts` | Eventos (packageRegistered, packageLoaded, manifestValidated, projectionGenerated, collectionRegistered) por **correlationId**. |

## Coleções federais (Part 4)

| Coleção | Categoria | Autoridade | Conteúdo |
|---|---|---|---|
| **Lei 14.133** | lei | Congresso Nacional | *(vazia)* |
| **Decretos** | decreto | Presidência da República | *(vazia)* |
| **IN SEGES** | instrucao_normativa | SEGES/ME | *(vazia)* |
| **AGU** | parecer | Advocacia-Geral da União | *(vazia)* |
| **TCU** | acordao | Tribunal de Contas da União | *(vazia)* |

`Decretos`, `IN SEGES`, `AGU` e `TCU` declaram dependência estrutural da coleção `Lei 14.133`.
**Nenhuma coleção contém conhecimento nesta RC.**

## Integridade & Lifecycle (Part 2)

O pacote calcula **checksums sha256** por coleção e um **checksum consolidado**; `verifyPackageIntegrity`
recomputa e detecta adulteração. O `replayHash` (32 hex) é determinístico sobre insumos estruturais.
O `lifecycle` é **append-only** (`transitionLifecycle` retorna novo pacote; nunca sobrescreve).

## Garantias

- **Multi-tenant:** manifesto/coleções/pacote/registro carregam `tenantId`; o registro rejeita
  registros cross-tenant.
- **Replay Safety:** ids/replayHash/checksums via sha256 sobre insumos estruturais (sem tempo em ids).
- **Determinismo:** mesmo tenant → mesmo pacote (id/replayHash/checksums) e mesma projeção.
- **Explainability & Auditabilidade:** todo pacote se explica; toda operação é observável.
- **Baixo acoplamento:** camada independente sobre a Legal Knowledge Foundation / Corpus Framework;
  não altera Kernel, IA, Document Engine ou Business Domains.
- **Sem instalação:** validação e registro são declarativos; nada é instalado/executado.

## Garantias por teste (`rc46-federal-procurement-corpus-package.test.ts`, ORG 12800)

Semver (parse/compare/satisfies), manifesto (campos + determinismo + multi-tenant), coleção vazia,
5 coleções federais (com dependências), pacote (checksums/replayHash/integridade + detecção de
adulteração + lifecycle append-only), registro (append-only + rejeição cross-tenant), validação
(pacote válido + versão divergente + coleção não referenciada + compatibilidade), projeção KG
determinística, todas as consultas, explainability (coleções com 0 unidades), observabilidade por
correlationId, replay safety. **Zero regressões.**

## Visão de longo prazo

O Federal Procurement Corpus é a **casca** oficial. A inserção futura de conteúdo (Lei 14.133,
decretos, IN SEGES, pareceres AGU, acórdãos TCU) ocorrerá apenas **preenchendo** as coleções com
`LegalKnowledgeUnit` (RC-4.5), **sem alterar a arquitetura** — o pacote já existe, versionado,
íntegro e explicável.

> A futura Lei 14.133 será apenas o **preenchimento** da coleção `Lei 14.133` deste pacote.
