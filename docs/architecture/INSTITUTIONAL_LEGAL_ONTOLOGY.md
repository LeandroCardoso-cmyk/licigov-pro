# Institutional Legal Ontology (RC-4.4)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-4.4 modela **como o conhecimento jurídico é organizado** — a **estrutura** do Direito,
> **não** o conteúdo. **Não ensina** Lei 14.133, acórdãos, jurisprudência ou doutrina. Ontologia
> **permanente, declarativa e determinística**, **independente** de qualquer lei/tribunal/país.
> Permite inserir futuras normas **sem alterar a arquitetura**.

## O que é

O modelo único da estrutura jurídica, em `server/domain/legal/`:

```
Hierarquia → Conceitos → Estruturas → Relacionamentos → Dependências → Classificações
```

## Componentes

| Componente | Arquivo | Conteúdo |
|---|---|---|
| **Tipos normativos** (15) | `normTypes.ts` | Norma, Lei, Decreto, Regulamento, Instrução Normativa, Portaria, Resolução, Acórdão, Parecer, Jurisprudência, Doutrina, Orientação Técnica, Nota Técnica, Manual, Guia. Cada um declara classificação, origem, escopo, **nível hierárquico** e dependências. |
| **Estrutura normativa** (10) | `normStructure.ts` | Título → Capítulo → Seção → Subseção → Artigo → Parágrafo → Inciso → Alínea → Item (+ Anexo). Árvore **acíclica** com pai/filhos/nível/posição. |
| **Conceitos jurídicos** (16) | `legalConcepts.ts` | Obrigação, Vedação, Permissão, Exceção, Condição, Hipótese, Competência, Prazo, Procedimento, Sanção, Requisito, Critério, Conceito, Definição, Remissão, Fundamentação — por categoria (deôntico, condicional, competencial, temporal, procedimental, sancionatório, qualificador, referencial). |
| **Modelo unificado** | `legalOntology.ts` | Relacionamentos (11 tipos), hierarquia, projeção KG, consulta, validação. |

## Hierarquia normativa (Part 5)

```
Lei → Decreto → Instrução Normativa → Portaria → Orientação Técnica → Manual → Nota Técnica
```

Cada tipo tem um `hierarchyLevel` (menor = mais alto). Toda dependência aponta para um nível
**superior** (validação monotônica). Judiciário/acadêmico (Acórdão, Jurisprudência, Doutrina,
Parecer) fundamentam-se em normas primárias — classificados como **entendimento**.

## Relacionamentos (Part 4)

11 tipos declarativos: `complementa`, `revoga`, `altera`, `regulamenta`, `referencia`,
`fundamenta`, `contradiz`, `excepciona`, `detalha`, `depende`, `hierarquia`.

## Classificações / taxonomias (Part 6)

`norma_primaria`, `norma_secundaria`, `norma_complementar`, `entendimento`, `jurisprudencia`,
`doutrina`, `orientacao`, `manual`, `parecer`.

## Knowledge Graph (Part 8 — preparação, não alimenta conteúdo)

`toLegalOntologyNodes()` / `toLegalOntologyEdges()` projetam a ontologia como nós
(`norm_type`/`structure`/`concept`/`classification`) e arestas tipadas (relacionamentos +
`depends_on` + `contains` + `classified_as`), determinísticos e desacoplados.

## Consulta pelo AIExecutionEngine (Part 9)

API de consulta pura (`getNormType`, `getStructuralElement`, `getLegalConcept`,
`getHierarchyLevel`, `getNormDependencies`, `normsByClassification`, `getLegalRelationships`,
`structuralPath`) — o Engine e os domínios **consultam** a estrutura jurídica **sem executar
IA nem conectar Provider**.

## Independência

Nenhum identificador referencia uma norma concreta (ex.: "14.133", "8.666"). Uma norma
específica pode ser instanciada no futuro **sem** alterar a ontologia (só a estrutura é modelada).

## Garantias por teste (`rc44-legal-ontology.test.ts`, ORG 12400)

15 tipos normativos, 10 elementos estruturais, 16 conceitos, 11 relacionamentos, hierarquia
monotônica, taxonomias, `validateLegalOntology` sem erros, **zero ciclos** (dependência + árvore
estrutural), projeção KG determinística, fingerprint estável, independência de lei específica.
**Zero regressões. Kernel/Business Domains inalterados.**

---

## Integração semântica (RC-4.4.1)

A ontologia jurídica é conectada à Ontologia Operacional por uma **camada semântica** desacoplada
(a jurídica **não** importa a integração). Ver [ONTOLOGY_INTEGRATION_LAYER.md](./ONTOLOGY_INTEGRATION_LAYER.md).

---

## Fundação de conhecimento jurídico (RC-4.5)

Sobre a **estrutura** definida aqui, a **Legal Knowledge Foundation** cria o *container*
permanente para armazenar qualquer conhecimento jurídico futuro (unidades, referências,
versões, conflitos, projeção, consultas) — **sem** inserir Lei 14.133/acórdãos/jurisprudência/
doutrina. Ver [LEGAL_KNOWLEDGE_FOUNDATION.md](./LEGAL_KNOWLEDGE_FOUNDATION.md).
