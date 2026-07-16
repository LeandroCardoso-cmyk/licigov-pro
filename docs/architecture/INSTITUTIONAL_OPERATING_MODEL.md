# Institutional Operating Model (RC-4.3)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-4.3 inaugura a fase de **Conhecimento Institucional**. O objetivo deixa de ser
> construir software e passa a ser modelar **como um Departamento de Licitações funciona** —
> **sem** ensinar Lei 14.133, acórdãos, jurisprudência ou doutrina. Ontologia **permanente,
> declarativa e determinística**, reutilizável por toda a camada cognitiva.

## O que é

O modelo operacional único do Departamento de Licitações, em
`server/domain/institutional/`:

```
Papéis → Objetos → Estados → Eventos → Dependências → Relacionamentos → Regras
```

Tudo é **declarativo** — nada executável, nada de workflow, nada de automação, nada de
conteúdo jurídico. Determinístico (IDs/fingerprint via sha256).

## Componentes

| Componente | Arquivo | Conteúdo |
|---|---|---|
| **Papéis** (13) | `roles.ts` | Agente de Contratação, Equipe de Apoio, Autoridade Competente, Secretário, Prefeito, Controle Interno, Assessoria Jurídica, Fiscal, Gestor, Fornecedor, Solicitante, Departamento, Comissão. Cada um declara responsabilidades, permissões, participação, documentos, dependências. |
| **Objetos** (18) | `objects.ts` | DFD, ETP, TR, Pesquisa de Preços, Edital, Aviso, Sessão, Ata, Contrato, Aditivo, Apostilamento, Parecer, Empenho (referência), Publicação, Checklist, Evento, Processo, Contratação Direta. Cada um declara finalidade, entradas, saídas, relacionamentos, estados possíveis, dependências. |
| **Estados** (10) | `states.ts` | Recebido, Em elaboração, Em revisão, Aguardando aprovação, Publicado, Em execução, Suspenso, Cancelado, Concluído, Arquivado — com transições declaradas (não é workflow). |
| **Eventos** (10) | `events.ts` | Recebimento, Solicitação, Publicação, Sessão, Assinatura, Vigência, Vencimento, Renovação, Rescisão, Arquivamento — com origem, destino, objetos e papéis. |
| **Regras operacionais** | `operationalRules.ts` | "Não existe X sem Y" (Contrato sem Contratação, Aditivo sem Contrato, Sessão sem Edital, Ata sem Sessão…). **Operacionais, não jurídicas.** |
| **Modelo unificado** | `operatingModel.ts` | Relacionamentos (cria/altera/aprova/consulta/referencia/depende/substitui/encerra), cadeia de dependências canônica, validação (consistência + zero ciclos), projeção KG, consulta. |

## Dependências (cadeia canônica, acíclica)

```
DFD → ETP → TR → Pesquisa → Edital → Sessão → Ata → Contrato → Execução → Encerramento
```

Validado por detecção de ciclos (DFS) — **zero ciclos** no grafo de dependências de objetos.

## Relacionamentos (Part 3)

Declarativos, cobrindo os 8 tipos: `cria`, `altera`, `aprova`, `consulta`, `referencia`,
`depende`, `substitui`, `encerra` — entre papéis↔objetos e objetos↔objetos.

## Knowledge Graph (Part 9 — preparação, não alimenta jurídico)

`toOntologyNodes()` / `toOntologyEdges()` projetam a ontologia como nós
(`role`/`object`/`state`/`event`) e arestas tipadas (relacionamentos + `depends_on` +
`has_state` + `event_relates`), determinísticos e desacoplados do KG jurídico org-scoped.

## Consulta pelo AIExecutionEngine (Part 10)

API de consulta pura (`getObjectDependencies`, `getDependents`, `getEventsForObject`,
`getRolesForObject`, `getRelationships`) — o Engine e os domínios **consultam** a ontologia
**sem alterar o pipeline cognitivo**.

## Garantias por teste (`rc43-institutional-operating-model.test.ts`, ORG 12200)

13 papéis, 18 objetos, 10 estados, 10 eventos, regras declarativas, relacionamentos (8 tipos),
dependências acíclicas, `validateOperatingModel` sem erros, projeção KG determinística,
fingerprint estável. **Zero regressões. Kernel/Business Domains inalterados.**

---

## Validação exaustiva (RC-4.3.1)

A ontologia foi validada exaustivamente: integridade por seção (zero issues), **20 cenários
institucionais representáveis** (pregão, dispensa, registro de preços, convênio, legados,
híbridos ERP+LiciGov, incompletos), cobertura de **100%** dos elementos e detecção de
inconsistências (resiliência). Ver [INSTITUTIONAL_ONTOLOGY_VALIDATION.md](./INSTITUTIONAL_ONTOLOGY_VALIDATION.md).
