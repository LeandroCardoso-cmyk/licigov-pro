# Modelo de Grafo

## Visao Geral

O modelo de grafo do LiciGov Pro utiliza um grafo direcionado ponderado onde nos
representam entidades do dominio e arestas representam relacoes semanticas tipadas.
Cada elemento carrega metadados de peso, confianca e proveniencia.

## Tipos de Nos (NodeType)

Cada no do grafo pertence a um dos seguintes tipos:

### `processo`
Representa um processo licitatorio completo.
- Metadata: numero, ano, modalidade, status, valor_estimado
- Exemplo: "Pregao Eletronico 001/2026"

### `documento`
Documento gerado ou anexado ao processo.
- Metadata: tipo (DFD/ETP/TR/Edital), versao, data_criacao, autor
- Exemplo: "TR-001-2026-v2"

### `entidade`
Pessoa juridica, orgao ou unidade administrativa.
- Metadata: cnpj, esfera (federal/estadual/municipal), tipo
- Exemplo: "Secretaria Municipal de Saude"

### `conceito`
Termo ou conceito do dominio de licitacoes (vinculado a ontologia).
- Metadata: category, base_legal, aliases
- Exemplo: "Pregao Eletronico"

### `norma`
Dispositivo legal (lei, decreto, instrucao normativa).
- Metadata: tipo_norma, numero, data_publicacao, vigencia
- Exemplo: "Lei 14.133/2021, Art. 18"

### `clausula`
Secao ou clausula especifica de um documento.
- Metadata: tipo_clausula, obrigatoria (bool), conteudo_resumo
- Exemplo: "Clausula de Vigencia do Contrato"

### `orgao`
Orgao publico participante (pode ser demandante, fiscalizador, etc.).
- Metadata: esfera, poder, uf, municipio
- Exemplo: "Prefeitura Municipal de Belo Horizonte"

## Tipos de Arestas (EdgeType)

As arestas representam relacoes semanticas direcionadas entre nos:

### `fundamenta`
Indica que o no origem fornece base legal ou tecnica para o no destino.
- Direcao: norma -> documento, documento -> documento
- Exemplo: "Art. 18 da Lei 14.133" `fundamenta` "ETP do Processo 001/2026"

### `compoe`
Indica que o no origem faz parte da estrutura do no destino.
- Direcao: clausula -> documento, documento -> processo
- Exemplo: "Clausula de Objeto" `compoe` "Termo de Referencia"

### `referencia`
Indica citacao ou mencao sem relacao de dependencia direta.
- Direcao: documento -> norma, documento -> documento
- Exemplo: "Edital" `referencia` "Decreto 10.024/2019"

### `exige`
Indica requisito ou pre-condicao.
- Direcao: documento -> conceito, fase -> documento
- Exemplo: "TR" `exige` "Habilitacao Tecnica"

### `complementa`
Indica que o no origem adiciona informacao ao no destino.
- Direcao: documento -> documento
- Exemplo: "Parecer Juridico" `complementa` "Edital"

### `substitui`
Indica que o no origem torna o no destino obsoleto/superado.
- Direcao: norma -> norma, documento -> documento
- Exemplo: "Lei 14.133/2021" `substitui` "Lei 8.666/1993"

### `conflita`
Indica inconsistencia ou contradicao detectada entre nos.
- Direcao: bidirecional (ambos conflitam)
- Exemplo: "Valor no TR" `conflita` "Valor no ETP"

## Modelo de Peso e Confianca

Cada aresta possui dois atributos numericos:

### Weight (Peso) - 0 a 1
Indica a forca ou relevancia da relacao.
- **1.0** - Relacao obrigatoria/essencial (Art. 18 fundamenta ETP)
- **0.7-0.9** - Relacao forte (clausula frequentemente presente)
- **0.4-0.6** - Relacao moderada (referencia util mas nao essencial)
- **0.1-0.3** - Relacao fraca (mencao tangencial)

### Confidence (Confianca) - 0 a 1
Indica o grau de certeza de que a relacao e correta.
- **1.0** - Extraida manualmente ou por regra deterministica
- **0.8-0.9** - Extraida por LLM com alta confianca
- **0.5-0.7** - Inferida por similaridade ou heuristica
- **< 0.5** - Candidata a revisao humana

## Schema Drizzle

Tabelas: `kg_nodes` (id, workspace_id, type, name, description, metadata, embedding, source_document_id, timestamps) e `kg_edges` (id, workspace_id, source_node_id, target_node_id, type, weight, confidence, metadata, created_by, created_at).

```typescript
// kg_nodes - campos principais
export const kgNodes = mysqlTable('kg_nodes', {
  id: varchar('id', { length: 36 }).primaryKey(),
  workspaceId: int('workspace_id').notNull(),
  type: varchar('type', { length: 32 }).notNull(),
  name: varchar('name', { length: 512 }).notNull(),
  metadata: json('metadata').$type<Record<string, unknown>>(),
  embedding: json('embedding').$type<number[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// kg_edges - campos principais
export const kgEdges = mysqlTable('kg_edges', {
  id: varchar('id', { length: 36 }).primaryKey(),
  sourceNodeId: varchar('source_node_id', { length: 36 }).notNull(),
  targetNodeId: varchar('target_node_id', { length: 36 }).notNull(),
  type: varchar('type', { length: 32 }).notNull(),
  weight: decimal('weight', { precision: 3, scale: 2 }).notNull(),
  confidence: decimal('confidence', { precision: 3, scale: 2 }).notNull(),
  createdBy: varchar('created_by', { length: 32 }).notNull(),
});
```

## Restricoes e Validacoes

1. **Integridade referencial:** `sourceNodeId` e `targetNodeId` devem existir em `kg_nodes`
2. **Sem auto-referencia:** Um no nao pode ter aresta para si mesmo
3. **Unicidade de aresta:** Apenas uma aresta de cada tipo entre o mesmo par de nos
4. **Compatibilidade de tipos:** Nem toda combinacao NodeType-EdgeType e valida

Matriz de compatibilidade (arestas permitidas):

| EdgeType | Origem permitida | Destino permitido |
|----------|-----------------|-------------------|
| fundamenta | norma, documento | documento, clausula |
| compoe | clausula, documento | documento, processo |
| referencia | documento, clausula | norma, documento, conceito |
| exige | documento, norma | conceito, documento |
| complementa | documento | documento |
| substitui | norma, documento | norma, documento |
| conflita | qualquer | qualquer (mesmo tipo) |

## Exemplo de Query de Grafo

### Buscar fundamentacoes de um documento
```sql
SELECT n.name, e.weight, e.confidence
FROM kg_edges e
JOIN kg_nodes n ON n.id = e.source_node_id
WHERE e.target_node_id = :documentoId
  AND e.type = 'fundamenta'
ORDER BY e.weight DESC;
```
