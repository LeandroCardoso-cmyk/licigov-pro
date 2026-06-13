---
name: lei-14133
description: Use esta skill sempre que qualquer decisão de implementação depender de regras da Lei 14.133/2021 — modalidades, prazos, critérios de julgamento, habilitação, ou estrutura de documentos. Serve como referência jurídica rápida para o agente não gerar documentos com erros legais.
---

# Skill: Lei 14.133/2021 — Referência para o Agente

## Modalidades e quando usar cada uma

| Modalidade | Quando usar | Valor referência |
|---|---|---|
| Pregão | Bens e serviços comuns (especificáveis por padrão de mercado) | Qualquer valor |
| Concorrência | Bens/serviços especiais e obras/serviços de engenharia | Acima dos limiares |
| Concurso | Trabalho técnico, científico ou artístico | Qualquer valor |
| Leilão | Alienação de bens imóveis/móveis | Qualquer valor |
| Diálogo Competitivo | Inovação tecnológica ou técnica | Qualquer valor |
| Dispensa (art. 75) | Contratação direta por valor ou situação específica | Ver limiares |
| Inexigibilidade (art. 74) | Fornecedor exclusivo ou notória especialização | Qualquer valor |

## Limiares de dispensa (art. 75, I e II — valores vigentes)
- **Obras e serviços de engenharia:** até R$ 100.000,00
- **Outros bens e serviços:** até R$ 50.000,00
- Atenção: valores podem ser atualizados por decreto. Verificar PNCP.

## Fluxo obrigatório de documentos (art. 18)

```
DFD → ETP → TR (ou Projeto Básico para obras) → Edital → Licitação → Contrato
```

- **DFD** obrigatório: art. 12, § 1º
- **ETP** obrigatório (salvo dispensa e inexigibilidade de baixo valor): art. 18
- **TR** para bens e serviços: art. 6º, XXIII
- **Projeto Básico** para obras: art. 6º, IX

## Habilitação — 4 blocos obrigatórios (art. 62-70)

### Bloco A — Habilitação Jurídica (art. 66)
- Cédula de identidade (pessoa física)
- Registro comercial (empresa individual)
- Ato constitutivo, estatuto ou contrato social (sociedades)
- Decreto de autorização (empresa estrangeira)

### Bloco B — Qualificação Técnica (art. 67)
- Registro ou inscrição no órgão profissional competente
- Comprovação de aptidão (atestados de capacidade técnica)
- Qualificação técnica operacional (para obras e serviços de engenharia)
- Qualificação técnica profissional (para obras e serviços de engenharia)

### Bloco C — Qualificação Econômico-Financeira (art. 69)
- Balanço patrimonial (ou equivalente)
- Demonstração de resultado (últimos 2 exercícios)
- Certidão negativa de falência
- Índices financeiros (LC, LG, SG) conforme edital

### Bloco D — Regularidade Fiscal e Trabalhista (art. 68)
- CND Federal (Receita + PGFN)
- CND Estadual
- CND Municipal
- CRF (FGTS)
- CNDT (trabalhista)
- Inscrição no CNPJ e/ou CPF

## Critérios de julgamento (art. 33)

| Critério | Quando usar |
|---|---|
| Menor preço | Objeto padronizado, especificação objetiva |
| Maior desconto | Tabelas de preços pré-fixadas |
| Melhor técnica | Serviços intelectuais sem padronização |
| Técnica e preço | Serviços com componente técnico relevante |
| Maior lance | Leilões |
| Maior retorno econômico | Contratos de eficiência |

## Prazos mínimos legais (art. 55)

| Modalidade | Critério | Prazo mínimo para propostas |
|---|---|---|
| Pregão | Qualquer | 8 dias úteis |
| Concorrência | Menor preço / Maior desconto | 25 dias úteis |
| Concorrência | Técnica e preço / Melhor técnica | 35 dias úteis |
| Concurso | — | 35 dias úteis |
| Leilão | — | 20 dias úteis |
| Diálogo Competitivo | — | 25 dias úteis |

## RAG — artigos mais referenciados nos documentos

Ao implementar o sistema RAG em `server/services/`, priorizar embeddings de:

- **Art. 6º** — Definições (TR, Projeto Básico, serviço comum, etc.)
- **Art. 12** — DFD
- **Art. 18** — ETP
- **Art. 33** — Critérios de julgamento
- **Art. 55** — Prazos
- **Art. 62-70** — Habilitação
- **Art. 74** — Inexigibilidade
- **Art. 75** — Dispensa
- **Art. 92-100** — Contratos
- **Art. 117** — Gestão e fiscalização de contratos

## Campos obrigatórios do Edital (art. 25)

O edital deve conter no mínimo:
1. Objeto com descrição clara e precisa
2. Critério de julgamento
3. Modalidade e modo de disputa
4. Local e prazo de entrega/execução
5. Condições de participação (habilitação)
6. Sanções pelo descumprimento
7. Minuta do contrato (quando aplicável)
8. Dotação orçamentária

## Modos de disputa (art. 56)

| Modo | Descrição |
|---|---|
| Aberto | Lances públicos e sucessivos, em sessão pública |
| Fechado | Propostas sigilosas abertas simultaneamente |
| Aberto e fechado | Combinação dos dois modos |
| Aleatório | Sorteio entre propostas de igual valor |

## Termos que o agente deve usar corretamente

| Usar | Não usar |
|---|---|
| Agente de contratação | Pregoeiro (para Concorrência) |
| Pregoeiro | Agente de contratação (para Pregão) |
| Autoridade competente | Ordenador de despesas |
| Contratante | Administração Pública / Município |
| Contratada | Empresa / Fornecedor (informal) |
| Licitante | Participante |
| Dispensa | Dispensa de licitação |
| Inexigibilidade | Inexigibilidade de licitação |

## Aviso obrigatório em todo documento gerado

```
ATENÇÃO: Este documento foi gerado com auxílio de inteligência artificial 
com base na Lei Federal nº 14.133/2021. O agente de contratação responsável 
deve revisar o conteúdo antes de qualquer publicação ou uso oficial.
A IA pode cometer erros. Verifique artigos, prazos e valores.
```
