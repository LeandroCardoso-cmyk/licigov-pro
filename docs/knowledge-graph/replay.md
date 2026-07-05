# Replay Safety

## Princípio

O Knowledge Graph é **determinístico e reconstruível**: dado o mesmo input, o
sistema sempre produz o mesmo ID, a mesma aresta e o mesmo grafo. Isso permite
reexecutar (replay) qualquer sequência de operações e chegar exatamente ao mesmo
estado — condição essencial para auditoria, rastreabilidade e reprodutibilidade.

## Proibições

Para garantir replay safety, o módulo **jamais** usa:

- `Date.now()` — timestamps não determinísticos.
- `Math.random()` — aleatoriedade.
- IDs gerados por UUID aleatório, autoincremento ou qualquer fonte não
  reprodutível.

Qualquer necessidade de tempo vem de valores explícitos passados no input (ex.:
`occurredAt` fornecido pelo chamador), nunca do relógio do processo.

## IDs determinísticos

Todo ID de nó e aresta é derivado por hash do seu conteúdo canônico:

```ts
import { createHash } from 'crypto';

function nodeId(orgId: string, nodeType: string, canonicalKey: string): string {
  return createHash('sha256')
    .update(`${orgId}:${nodeType}:${canonicalKey}`)
    .digest('hex');
}
```

Mesmo conteúdo → mesmo hash → mesmo ID. Inserir o mesmo nó duas vezes é
idempotente.

## `deterministicKey` nas arestas

Cada aresta carrega um `deterministicKey` = hash de
`orgId + source + target + relationshipType`:

```ts
const deterministicKey = createHash('sha256')
  .update(`${orgId}:${sourceNodeId}:${targetNodeId}:${relationshipType}`)
  .digest('hex');
```

Isso garante que a **mesma relação** entre os mesmos nós nunca seja duplicada,
independentemente da ordem de execução.

## `replayHash`

Operações produzem um `replayHash` que resume o efeito da mutação. Comparar o
`replayHash` de uma reexecução com o original confirma que o replay reproduziu
exatamente o mesmo resultado.

## `correlationId`

O `correlationId` é **propagado do contexto tRPC** (`ctx`) através de services e
repository até o change log. Ele conecta todas as mutações originadas de uma
mesma requisição, permitindo rastrear uma operação de ponta a ponta sem depender
de timestamps.

## Lineage persistido

Duas tabelas garantem a reconstrutibilidade:

- **`graph_change_log`** — registra o **before/after state** de cada mutação
  (nó ou aresta criado, atualizado ou desativado), junto com `correlationId` e
  `replayHash`.
- **`graph_versions`** — registra snapshots de versão do grafo.

```ts
await insertGraphChangeLog({
  orgId,
  correlationId,
  entityId: node.id,
  operation: 'insert',
  before: null,
  after: JSON.stringify(node),
  replayHash,
});
```

## Reconstrução integral

Como todo evento de mudança está no `graph_change_log` com estado before/after e
IDs determinísticos, **o grafo inteiro pode ser reconstruído a partir do change
log**: reaplicando os eventos em ordem, chega-se ao mesmo estado final. Nenhum
dado do grafo é "originado" de forma não rastreável.

## Operações determinísticas

Resumo da garantia:

```
mesmo input → mesmo ID → mesma aresta → mesmo grafo
```

- Idempotência: repetir uma operação não altera o resultado.
- Ordem-independência para IDs: o ID de um nó não depende de quando foi criado.
- Auditabilidade: cada mudança tem `correlationId`, `replayHash` e before/after.

Esse contrato torna o Knowledge Graph seguro para reprocessamento, migração e
verificação de integridade sem risco de divergência.
