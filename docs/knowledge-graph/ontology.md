# Ontologia de Licitacoes

## Definicao

A ontologia do LiciGov Pro define a estrutura conceitual do dominio de licitacoes
publicas conforme a Lei 14.133/2021. Ela estabelece categorias, hierarquias e
propriedades que permitem ao Knowledge Graph interpretar e relacionar entidades
de forma semanticamente correta.

Uma ontologia bem definida garante:
- Consistencia na classificacao de entidades extraidas
- Validacao de relacoes (uma modalidade nao pode "compor" outra modalidade)
- Navegacao hierarquica (Pregao Eletronico e subtipo de Licitacao)
- Extensibilidade controlada para novos dominios

## Categorias Principais

### 1. `modalidade`
Formas de contratacao previstas na Lei 14.133/2021.

| Conceito | Base Legal | Descricao |
|----------|-----------|-----------|
| Pregao | Art. 6, XLI | Modalidade para aquisicao de bens e servicos comuns |
| Concorrencia | Art. 6, XXXVIII | Modalidade para obras, servicos especiais, compras |
| Concurso | Art. 6, XXXIX | Selecao de trabalho tecnico, cientifico ou artistico |
| Leilao | Art. 6, XL | Alienacao de bens imoveis ou moveis inservíveis |
| Dialogo Competitivo | Art. 6, XLII | Inovacao tecnologica ou tecnica |

### 2. `criterio_julgamento`
Criterios de selecao de propostas (Art. 33).

- Menor Preco (Art. 33, I)
- Maior Desconto (Art. 33, II)
- Melhor Tecnica ou Conteudo Artistico (Art. 33, III)
- Tecnica e Preco (Art. 33, IV)
- Maior Lance (Art. 33, V)
- Maior Retorno Economico (Art. 33, VI)

### 3. `fase_processual`
Etapas do processo licitatorio.

- Planejamento (DFD, ETP, TR)
- Divulgacao (Publicacao do Edital)
- Apresentacao de Propostas
- Julgamento
- Habilitacao
- Recursal
- Homologacao
- Contratacao

### 4. `tipo_documento`
Documentos gerados ou consumidos no processo.

- DFD (Documento de Formalizacao da Demanda)
- ETP (Estudo Tecnico Preliminar)
- TR (Termo de Referencia)
- Edital
- Parecer Juridico
- Ata de Registro de Precos
- Contrato
- Aditivo

### 5. `clausula`
Clausulas e secoes padrao de documentos licitatorios.

- Objeto
- Justificativa
- Fundamentacao Legal
- Requisitos de Habilitacao
- Criterios de Aceitabilidade
- Obrigacoes do Contratado
- Obrigacoes do Contratante
- Sancoes
- Vigencia

### 6. `entidade_publica`
Orgaos e entidades participantes do processo.

- Orgao Demandante
- Setor de Licitacoes
- Procuradoria / Assessoria Juridica
- Autoridade Competente
- Pregoeiro / Comissao de Contratacao
- Fiscal de Contrato
- Gestor de Contrato

## Hierarquia de Conceitos

A ontologia utiliza relacao parent-child para modelar hierarquias:

```
Licitacao (raiz)
├── Pregao (Eletronico | Presencial)
├── Concorrencia (Eletronica | Presencial)
├── Concurso
├── Leilao (Eletronico | Presencial)
└── Dialogo Competitivo

Contratacao Direta (raiz)
├── Dispensa de Licitacao (por Valor | por Situacao | Eletronica)
└── Inexigibilidade (Fornecedor Exclusivo | Servicos Tecnicos | Setor Artistico)
```

## Propriedades de Cada Conceito

Todo conceito na ontologia possui as seguintes propriedades:

```typescript
interface ConceptProperties {
  id: string;              // UUID
  name: string;            // Nome canonico (ex: "Pregao Eletronico")
  category: CategoryType;  // Uma das 6 categorias acima
  definition: string;      // Definicao tecnica/juridica
  base_legal: string;      // Artigo(s) da Lei 14.133/2021
  aliases: string[];       // Nomes alternativos (ex: ["PE", "Pregao Online"])
  parent_id?: string;      // Conceito pai na hierarquia
  vigencia_inicio: Date;   // Data de inicio de vigencia
  vigencia_fim?: Date;     // Data de fim (null = vigente)
  metadata: Record<string, unknown>; // Propriedades adicionais
}
```

## Exemplo Concreto

```json
{
  "name": "Pregao Eletronico",
  "category": "modalidade",
  "definition": "Modalidade de licitacao obrigatoria para aquisicao de bens e servicos comuns, realizada em sessao publica por meio de sistema eletronico.",
  "base_legal": "Art. 6, XLI; Art. 17, § 2; Decreto 10.024/2019",
  "aliases": ["PE", "Pregao Online", "Pregao SRP"],
  "parent_id": "uuid-pregao",
  "vigencia_inicio": "2021-04-01"
}
```

## Relacao com a Lei 14.133/2021

| Categoria | Artigos Principais |
|-----------|-------------------|
| Modalidades | Art. 6 (XLI-XLII), Art. 28 |
| Criterios de Julgamento | Art. 33, Art. 34 |
| Fases Processuais | Art. 17 (ordem das fases) |
| Tipos de Documento | Art. 6 (XXIII), Art. 12, Art. 18, Art. 40 |
| Clausulas | Art. 89 (clausulas essenciais do contrato) |
| Entidades | Art. 7 (agentes publicos), Art. 8 |

## Extensibilidade

A ontologia foi projetada para extensao a novos dominios sem quebrar o existente:

1. **Novas categorias:** Adicionar novo `CategoryType` no enum
2. **Novos conceitos:** Inserir na tabela `kg_concepts` com parent_id adequado
3. **Novas relacoes validas:** Atualizar matriz de compatibilidade de arestas
4. **Novos aliases:** Adicionar ao array de aliases do conceito existente
