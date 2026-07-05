# Explainability — copilotDecisionTrace

## Responsabilidade

O `copilotDecisionTrace` registra a **cadeia completa de reasoning** que levou a cada
recomendação. Ele é a base da **explicabilidade** e do **replay safety**: nenhuma
recomendação existe sem um trace que a justifique de forma reproduzível.

> Toda recomendação é justificada com evidências do RAG e caminhos do Knowledge Graph.

## Posição no pipeline

```
... → Reasoning → Recommendation → Validation → [Explainability] → Response
                                                 └── copilotDecisionTrace ──┘
```

O trace é construído incrementalmente durante o reasoning e consolidado na etapa de
Explainability, imediatamente antes da resposta.

## Estrutura do trace

Cada `copilotDecisionTrace` (Drizzle / MySQL, escopo `organizationId`) contém:

- **identificação** — `traceId` determinístico (**SHA-256**), copiloto, sessão,
  recomendação e `correlationId`;
- **steps[]** — sequência ordenada de passos de reasoning;
- **lineage** — origem de cada evidência e transformação até a recomendação;
- **snapshot** — captura determinística das entradas suficientes para replay.

### steps[]

Cada passo registra:

- o **tipo** (intent classification, seleção, consulta ao Knowledge Graph, recuperação
  RAG, montagem de contexto, inferência, validação);
- as **entradas** e **saídas** do passo (ou seus hashes, para dados volumosos);
- as **evidências** consultadas — trechos do Institutional RAG e nós/arestas do
  Procurement Knowledge Graph;
- **decisões de política** aplicadas (ver `policies.md`).

## Lineage — de onde veio cada afirmação

O lineage torna auditável a **procedência** de cada elemento da recomendação:

- qual **artigo** da Lei 14.133/2021 fundamentou o ponto;
- quais **documentos** ou **modelos** do RAG foram citados;
- quais **caminhos do Knowledge Graph** conectaram as entidades da contratação;
- qual **memória semântica** institucional foi reutilizada.

Nenhuma recomendação contém afirmação sem lineage — isso operacionaliza o grounding
obrigatório definido no reasoning.

## Replay safety — snapshot determinístico

O trace armazena um **snapshot determinístico** das entradas: contexto fundamentado,
identificadores das evidências, parâmetros de inferência e versão das políticas.

Com o snapshot é possível **reexecutar o reasoning** e obter **o mesmo resultado**:

- IDs derivam de **SHA-256** sobre as entradas — mesmas entradas, mesmos IDs;
- o contexto é reconstruído idêntico pelo `PromptContextBuilder`;
- a inferência determinística (ou o modo grounding-only) reproduz a saída;
- divergências no replay sinalizam mudança de dados, política ou modelo — um sinal de
  auditoria, não uma falha silenciosa.

Isso sustenta a **verificabilidade**: um revisor humano ou o controle interno pode
reproduzir e conferir qualquer recomendação.

## Uso na interface

No Institutional Copilot Center, cada recomendação exibe seu trace de forma legível:

- a **linha do tempo** de steps;
- as **evidências** citadas (com origem no RAG e no grafo);
- as **políticas** avaliadas e o resultado;
- um botão de **replay** que reexecuta e compara o resultado.

## Garantias

- **determinismo (SHA-256)** em traceId, steps e snapshot;
- **multi-tenant** — traces isolados por `organizationId`;
- **correlationId** ligando trace, logs e audit trail de governança;
- **replay safety** — reprodução fiel a partir do snapshot.

## Degradação graciosa

Sem banco (padrão `getDb()`), o trace é montado em memória e retornado junto à
recomendação, mas **não é persistido**. Como a Approval Layer não aprova sem
rastreabilidade, nenhuma recomendação sem trace persistido produz efeito no processo.

## Referências

- `docs/copilots/reasoning.md` — construção dos steps e do contexto
- `docs/copilots/governance.md` — audit trail e aprovação
- `docs/copilots/evaluation.md` — uso do trace na avaliação de qualidade
