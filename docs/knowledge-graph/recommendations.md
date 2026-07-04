# Sistema de Recomendacoes

## Visao Geral

O sistema de recomendacoes utiliza o Knowledge Graph para sugerir conteudos relevantes
durante a elaboracao de documentos licitatorios. As recomendacoes sao contextuais,
explicaveis e baseadas em relacoes reais entre entidades juridicas.

## Tipos de Recomendacao

### Clausulas Sugeridas
- **Obrigatorias:** Exigidas por lei para o contexto atual
- **Recomendadas:** Frequentemente utilizadas em processos similares
- **Opcionais:** Podem agregar valor ao documento

### Base Legal Relevante
Artigos da Lei 14.133/2021 diretamente fundamentadores, complementares e jurisprudencia.

### Riscos Identificados
Alertas sobre ausencia de fundamentacao, conflitos entre clausulas, incompatibilidade
com modalidade e valores fora de faixa.

### Requisitos Faltantes
Elementos obrigatorios ausentes: requisitos legais, campos vazios, referencias cruzadas.

## Algoritmo de Recomendacao

### 1. Travessia a partir do contexto atual
```
contexto = {tipo_processo, modalidade, objeto, valor_estimado, documento_atual}
nos_relevantes = traversal(contexto, max_depth=3, min_weight=0.5)
```

### 2. Scoring de relevancia
```
score = peso_aresta * confianca * frequencia_historica * fator_contexto
```
- `peso_aresta` (0.0-1.0): Forca da relacao no grafo
- `confianca` (0.0-1.0): Confiabilidade da relacao
- `frequencia_historica` (0.0-1.0): Taxa de aceitacao historica
- `fator_contexto` (0.5-2.0): Multiplicador de relevancia contextual

### 3. Ranking
Recomendacoes ordenadas por score. Score abaixo de 0.3 descartado. Top 10 apresentadas.

## Contexto de Recomendacao

| Fator | Influencia |
|-------|-----------|
| Tipo de processo | Clausulas obrigatorias |
| Modalidade | Requisitos especificos (Pregao, Concorrencia) |
| Objeto | Clausulas tecnicas e qualificacao |
| Valor estimado | Limites e exigencias adicionais |
| Historico do orgao | Padroes anteriores aceitos |
| Etapa do documento | Prioridade por secao |

## Integracao com Geracao de Documentos

**DFD:** Sugere justificativas, alinhamento com plano de contratacoes, areas demandantes.

**ETP:** Sugere solucoes de mercado, criterios de sustentabilidade, riscos tipicos.

**TR:** Sugere especificacoes tecnicas, criterios de aceitacao, obrigacoes do contratado.
Alerta sobre clausulas restritivas de competitividade.

**Edital:** Sugere habilitacao compativel, prazos legais, criterios de julgamento.
Alerta sobre exigencias desproporcionais.

## Feedback Loop

### Acoes do usuario e ajuste de pesos
- **Aceitar:** Incrementa peso em +0.05 (max 1.0)
- **Rejeitar:** Decrementa peso em -0.03 (min 0.1)
- **Ignorar:** Sem alteracao
- **Editar:** Incrementa em +0.02

**Formula:** `novo_peso = peso_atual + (delta * learning_rate)` onde `learning_rate = 0.1`

### Limites de seguranca
- Pesos nunca abaixo de 0.1 ou acima de 1.0
- Ajustes aplicados apos minimo de 5 interacoes
- Reset parcial a cada 90 dias

## Exemplos por Tipo de Documento

### TR para aquisicao de equipamentos de TI
```json
{
  "contexto": {"modalidade": "pregao_eletronico", "objeto": "computadores", "valor": 500000},
  "recomendacoes": [
    {"tipo": "clausula", "conteudo": "Exigir certificacao EPEAT", "score": 0.89, "base": "Art. 18, XII"},
    {"tipo": "risco", "conteudo": "Especificacao de marca restringe competitividade", "score": 0.92, "base": "Art. 41, I"},
    {"tipo": "requisito_faltante", "conteudo": "Garantia minima nao especificada", "score": 0.85, "base": "Art. 40, III"}
  ]
}
```

### Edital de Concorrencia para obra
```json
{
  "contexto": {"modalidade": "concorrencia", "objeto": "construcao de escola", "valor": 5000000},
  "recomendacoes": [
    {"tipo": "clausula", "conteudo": "Exigir atestado para obra similar", "score": 0.95, "base": "Art. 67, II"},
    {"tipo": "base_legal", "conteudo": "Regime empreitada por preco global", "score": 0.88, "base": "Art. 46"}
  ]
}
```
