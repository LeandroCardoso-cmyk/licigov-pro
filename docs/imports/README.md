# LiciGov Pro — Motor de Importação

> Documentação do sistema de importação de dados externos: lifecycle, parsers, staging e canonicalização.
> Atualizado em: 2026-05-27

---

## Princípio Fundamental

> **Raw extraction NUNCA persiste diretamente no domínio.**

O fluxo de importação é rigorosamente controlado:
```
Upload → Ingestão → Parsing → Staging → Validação → Revisão Humana → Aprovação → Domínio
```

Este princípio garante:
- Rastreabilidade completa de origem de cada dado
- Revisão humana antes de qualquer persistência no domínio
- Reversibilidade total: staging pode ser rejeitado sem impacto
- Conformidade com a obrigatoriedade de pesquisa de preços documentada

---

## Ciclo de Vida da ImportSession

### 10 Status do Ciclo de Vida

```
uploaded → queued → parsing → extracted → normalized → awaiting_review
                                                           ↙         ↘
                                                       approved    rejected
                                                          ↓
                                                       archived
                                            (+ failed a qualquer ponto)
```

| Status | Descrição | Ação do Usuário |
|---|---|---|
| `uploaded` | Arquivo recebido, aguardando enfileiramento | — |
| `queued` | Na fila de processamento | Pode cancelar |
| `parsing` | Parser ativo, extraindo dados | Pode cancelar |
| `extracted` | Dados brutos extraídos, aguardando normalização | — |
| `normalized` | Dados normalizados, confiança calculada | — |
| `awaiting_review` | Aguardando revisão humana | Revisar itens |
| `approved` | Aprovado pelo usuário, pronto para promoção | Promover ao domínio |
| `rejected` | Rejeitado pelo usuário | — |
| `failed` | Falha técnica no processamento | Ver logs de erro |
| `archived` | Arquivado após processamento completo | — |

---

## Tipos de Importação

### `price_research` — Pesquisa de Preços
- **Finalidade**: Importar resultados de cotações de mercado
- **Formato típico**: XLSX ou CSV com colunas: fornecedor, item, unidade, valor
- **Destino no domínio**: `PesquisaPrecos` vinculada ao processo licitatório
- **Validações específicas**: CNPJ de fornecedor, unidade canônica, valor > 0

### `tr_items` — Itens do Termo de Referência
- **Finalidade**: Importar lista de itens para o TR a partir de planilha
- **Formato típico**: XLSX com: código, descrição, unidade, quantidade, valor unitário
- **Destino no domínio**: Itens do `DocumentoLicitatorio` tipo TR
- **Validações específicas**: Match CATMAT obrigatório a partir da Sprint 3

### `catmat` — Catálogo de Materiais
- **Finalidade**: Importar dados do CATMAT para uso interno
- **Formato típico**: CSV oficial do ComprasNet
- **Destino no domínio**: `CatmatItem` (tabela de referência)
- **Validações específicas**: Código CATMAT válido

### `generic` — Genérico
- **Finalidade**: Qualquer planilha estruturada sem tipo específico
- **Formato típico**: CSV ou XLSX
- **Destino no domínio**: A definir pelo operador
- **Validações específicas**: Apenas validações estruturais básicas

---

## Parsers

### CSV Parser
- **MIME types**: `text/csv`, `application/csv`
- **Extensões**: `.csv`
- **Detecção automática de delimitador**: `,`, `;`, `\t`, `|`
- **Encoding suportado**: UTF-8, Latin1 (auto-detect)
- **Limite**: 50MB, 100k linhas

### XLSX Parser (SheetJS)
- **MIME types**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Extensões**: `.xlsx`, `.xls`
- **Suporte a múltiplas planilhas**: Sim (hint de sheet name ou índice)
- **Detecção de cabeçalho**: Automática (primeira linha) ou linha configurável
- **Limite**: 50MB, 100k linhas

### PDF Parser (stub — Sprint 3)
- **MIME types**: `application/pdf`
- **Extensões**: `.pdf`
- **Status**: Interface definida, implementação na Sprint 3
- **Estratégia**: pdfjs + análise estrutural de tabelas

### DOCX Parser (stub — Sprint 3)
- **MIME types**: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- **Extensões**: `.docx`
- **Status**: Interface definida, implementação na Sprint 3
- **Estratégia**: Extração de tabelas e listas estruturadas

### ParserRegistry
O `ParserRegistry` resolve o parser correto para cada arquivo:
1. Por MIME type explícito
2. Por extensão de arquivo
3. Por hint explícito do usuário
4. Fallback: generic parser

---

## Canonicalização de Unidades

### CanonicalUnits Registry — 25 Unidades PT-BR

| Código Canônico | Sinônimos Aceitos | Descrição |
|---|---|---|
| `UN` | un, unid, unidade, und | Unidade |
| `KG` | kg, kilo, quilograma | Quilograma |
| `G` | g, grama, gr | Grama |
| `L` | l, litro, lt | Litro |
| `ML` | ml, mililitro | Mililitro |
| `M` | m, metro, mt | Metro linear |
| `M2` | m², m2, metro quadrado | Metro quadrado |
| `M3` | m³, m3, metro cúbico | Metro cúbico |
| `CX` | cx, caixa | Caixa |
| `PCT` | pct, pacote, pk | Pacote |
| `RL` | rl, rolo | Rolo |
| `RS` | rs, resma | Resma |
| `PC` | pc, peça | Peça |
| `JG` | jg, jogo | Jogo |
| `KIT` | kit | Kit |
| `PAR` | par, pares | Par |
| `FD` | fd, fardo | Fardo |
| `SC` | sc, saco | Saco |
| `TB` | tb, tubo | Tubo |
| `FR` | fr, frasco | Frasco |
| `AMP` | amp, ampola | Ampola |
| `COM` | com, comprimido | Comprimido |
| `H` | h, hr, hora | Hora |
| `DIA` | dia, d | Dia |
| `MES` | mês, mes, m | Mês |

---

## Sistema de Confiança (Confidence)

### Níveis de Confiança
| Nível | Score | Significado | Ação Recomendada |
|---|---|---|---|
| `high` | ≥ 0.85 | Alta certeza | Aprovação em lote permitida |
| `medium` | ≥ 0.60 | Confiança moderada | Revisão opcional |
| `low` | ≥ 0.35 | Baixa certeza | Revisão manual recomendada |
| `uncertain` | < 0.35 | Incerteza alta | Revisão manual obrigatória |

### Fatores que Impactam o Score
- Match de unidade canônica: +0.20 se exato, -0.30 se não encontrado
- Formato de valor numérico: +0.15 se válido
- Completude de campos obrigatórios: +0.10 por campo
- Match com dados históricos: +0.20 se encontrado
- Inconsistência de dados: -0.40 se detectada

---

## ExtractionProvenance

Cada item extraído tem proveniência completa registrada:

```typescript
interface ExtractionProvenance {
  sourceFile: string;          // Nome do arquivo original
  sheet?: string;              // Nome da planilha (XLSX)
  row?: number;                // Número da linha
  column?: string;             // Identificador da coluna (A, B, etc.)
  page?: number;               // Número da página (PDF)
  rawValue: string;            // Valor bruto antes da normalização
  normalizedValue: unknown;    // Valor após normalização
  normalizationSteps: string[]; // Passos de transformação aplicados
}
```

---

## Serviços

### FileIngestionService
- Valida MIME type e tamanho do arquivo
- Persiste no storage (Railway Volume ou S3-compatible)
- Cria `ImportSession` com status `uploaded`
- Enfileira para processamento

### ImportStagingService
- Recebe dados extraídos do parser
- Normaliza unidades com `CanonicalUnits`
- Calcula scores de confiança
- Persiste em `import_staging` com proveniência completa

### ImportQueueService
- Fila in-process com retry exponential backoff (3 tentativas)
- Dead Letter Queue para itens que falham após retries
- Concorrência configurável (padrão: 3 sessões simultâneas)
- Logs de cada tentativa para diagnóstico

---

*Para motor documental: [architecture/DOCUMENT_ENGINE.md](../../architecture/DOCUMENT_ENGINE.md)*
*Para arquitetura de importação: [architecture/IMPORT_ENGINE.md](../../architecture/IMPORT_ENGINE.md)*
