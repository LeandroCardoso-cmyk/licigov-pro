# Resolucao de Entidades

## O Problema

No dominio de licitacoes publicas, a mesma entidade frequentemente aparece com
nomes diferentes em documentos distintos. Sem resolucao adequada, o Knowledge Graph
acumularia nos duplicados que representam o mesmo conceito, degradando a qualidade
das recomendacoes e da navegacao semantica.

### Exemplos de ambiguidade

| Mencao no documento | Entidade canonica |
|---------------------|-------------------|
| "Pregao Eletronico" | Pregao Eletronico |
| "PE" | Pregao Eletronico |
| "Pregao" | Pregao Eletronico |
| "pregao eletronico" | Pregao Eletronico |
| "Pregao On-line" | Pregao Eletronico |

| Mencao no documento | Entidade canonica |
|---------------------|-------------------|
| "Lei 14.133/2021" | Lei 14.133/2021 |
| "Nova Lei de Licitacoes" | Lei 14.133/2021 |
| "NLLC" | Lei 14.133/2021 |
| "Lei de Licitacoes e Contratos" | Lei 14.133/2021 |

| Mencao no documento | Entidade canonica |
|---------------------|-------------------|
| "Sec. Mun. de Saude" | Secretaria Municipal de Saude |
| "SMS" | Secretaria Municipal de Saude |
| "Secretaria de Saude" | Secretaria Municipal de Saude |

## Estrategias de Resolucao

O motor de resolucao implementa quatro estrategias, aplicadas em cascata:

| Estrategia | Descricao | Precisao | Threshold | Exemplo |
|------------|-----------|----------|-----------|---------|
| **Exact** | Normalizacao + comparacao direta | 100% | N/A | "pregao eletronico" -> "Pregao Eletronico" |
| **Alias** | Lookup na tabela `kg_concepts.aliases` | Muito alta | N/A | "PE" -> "Pregao Eletronico" |
| **Fuzzy** | Levenshtein + Jaro-Winkler | Alta | 0.85 | "Pregao Eletronic" -> score 0.94 |
| **Semantic** | Similaridade de embedding (768d) | Media-alta | 0.80 | "Nova Lei de Licitacoes" -> score 0.87 |

## Pipeline de Resolucao

```
[Mencao extraida do documento]
         |
         v
[1. Normalizacao] ---------> lowercase, trim, remove acentos, 
         |                    remove pontuacao extra
         v
[2. Exact Match] ----------> Encontrou? -> RESOLVIDO (confidence: 1.0)
         |                         |
         | nao                     |
         v                         |
[3. Alias Match] ----------> Encontrou? -> RESOLVIDO (confidence: 0.95)
         |                         |
         | nao                     |
         v                         |
[4. Fuzzy Match] ----------> Score >= threshold? -> CANDIDATO
         |                         |
         | nao                     |
         v                         |
[5. Semantic Match] --------> Score >= threshold? -> CANDIDATO
         |                         |
         | nao                     |
         v                         v
[NOVO NO] (criar entidade)   [SCORING & RANKING]
                                    |
                                    v
                             [Score final >= merge_threshold?]
                                /              \
                              sim               nao
                               |                 |
                               v                 v
                           [MERGE]          [REVISAO MANUAL]
```

## Regras de Merge

Quando duas mencoes sao resolvidas como a mesma entidade:

### Qual registro prevalece
1. O registro com `confidence` mais alta e o canonico
2. Em empate, o registro mais antigo (criado primeiro) prevalece
3. Registros criados por usuario (`createdBy: 'user'`) prevalecem sobre automaticos

### Preservacao de historico
- O no duplicado nao e deletado — recebe flag `merged_into: <canonical_id>`
- Arestas do no duplicado sao redirecionadas para o canonico
- Aliases do duplicado sao adicionados ao canonico
- Log de merge e registrado para auditoria

### Operacao de merge
```typescript
interface MergeOperation {
  canonicalNodeId: string;   // No que permanece
  duplicateNodeId: string;   // No que sera marcado como merged
  strategy: 'exact' | 'fuzzy' | 'alias' | 'semantic';
  score: number;             // Score que motivou o merge
  mergedBy: 'system' | 'user';
  mergedAt: Date;
  reversible: boolean;       // Sempre true — merges podem ser desfeitos
}
```

## Deduplicacao Automatica vs Manual

### Automatica (sem intervencao humana)
Aplicada quando:
- Exact match ou alias match (confianca >= 0.95)
- Fuzzy match com score >= 0.95
- Entidade ja possui historico de merge similar bem-sucedido

### Semi-automatica (workspace de resolucao)
Aplicada quando:
- Fuzzy match com score entre 0.85 e 0.95
- Semantic match com score entre 0.80 e 0.90
- Sistema apresenta candidatos para usuario confirmar/rejeitar

### Manual (intervencao obrigatoria)
Necessaria quando:
- Scores abaixo dos thresholds automaticos mas acima do minimo
- Conflitos de tipo (mencao poderia ser mais de uma entidade)
- Entidades de categorias diferentes com nomes similares

## Metricas do Resolver

O motor de resolucao e avaliado por:

| Metrica | Definicao | Meta |
|---------|-----------|------|
| **Precision** | Merges corretos / Total de merges realizados | >= 0.95 |
| **Recall** | Duplicatas detectadas / Total de duplicatas reais | >= 0.85 |
| **F1** | Media harmonica de Precision e Recall | >= 0.90 |

## Configuracao de Thresholds por Tipo

Cada tipo de entidade possui thresholds especificos:

| NodeType | Fuzzy Threshold | Semantic Threshold | Auto-merge Threshold |
|----------|----------------|-------------------|---------------------|
| conceito | 0.90 | 0.85 | 0.95 |
| norma | 0.85 | 0.80 | 0.92 |
| orgao | 0.80 | 0.78 | 0.90 |
| processo | 0.95 | 0.90 | 0.98 |
| documento | 0.92 | 0.85 | 0.95 |
| clausula | 0.85 | 0.80 | 0.92 |
| entidade | 0.80 | 0.75 | 0.90 |

Justificativa:
- **Processos** tem threshold alto porque numeros de processo sao quase unicos
- **Orgaos** tem threshold mais baixo porque abreviacoes sao muito comuns
- **Conceitos** tem threshold alto para evitar confusao entre termos similares
