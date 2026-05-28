# LiciGov Pro — Domínio Jurídico-Operacional

> Documentação do domínio de licitações públicas: base legal, tipos de documento e fluxos.
> Atualizado em: 2026-05-27

---

## Fundamento Legal

### Lei 14.133/2021 — Nova Lei de Licitações
A Lei 14.133, de 1º de abril de 2021, estabelece normas gerais de licitação e contratação para a Administração Pública. Substituiu progressivamente as Leis nº 8.666/1993, 10.520/2002 e 12.462/2011.

**Artigos centrais para o LiciGov Pro:**

| Artigo | Assunto | Impacto no Sistema |
|---|---|---|
| Art. 6º, XXIII | Definição de Termo de Referência | Tipo de documento `tr` |
| Art. 18 | Estudo Técnico Preliminar | Tipo de documento `etp` |
| Art. 25 | Edital de licitação | Tipo de documento `edital` |
| Art. 90 | Contratos administrativos | Tipo de documento `contrato` |
| Art. 169 | Retenção de documentos (5 anos) | RetentionClass `legal_7years` (mais restritivo) |
| Art. 174 | Sistema de registro de preços | Import type `price_research` |
| Art. 185 | Portal Nacional de Contratações Públicas | Integração PNCP futura |

### Regulamentação Complementar

- **Decreto 11.246/2022** — Regulamenta o PNCP (Portal Nacional de Contratações Públicas)
- **IN SEGES/ME 65/2021** — Normas para estudos preliminares
- **IN SEGES/ME 58/2022** — TR e ETP para TI
- **Lei 13.709/2018 (LGPD)** — Proteção de dados pessoais (retenção e purge)

---

## Tipos de Documento

### Termo de Referência (TR)
- **Código no sistema**: `tr`
- **Base legal**: Art. 6º, XXIII, Lei 14.133/2021
- **Finalidade**: Descrever o objeto da contratação com todos os requisitos técnicos necessários
- **Quando é obrigatório**: Toda contratação de serviços, obras e fornecimento de bens
- **Seções obrigatórias pelo sistema**:
  - Objeto e justificativa da contratação
  - Especificações técnicas detalhadas
  - Critérios de sustentabilidade (se aplicável)
  - Estimativa de preços com pesquisa de mercado
  - Prazo de entrega ou execução
  - Forma de pagamento
  - Critérios de aceitação
- **Workflow padrão**: `draft → in_review → approved → archived`
- **Retenção**: `legal_7years`

### Estudo Técnico Preliminar (ETP)
- **Código no sistema**: `etp`
- **Base legal**: Art. 18, Lei 14.133/2021
- **Finalidade**: Analisar a viabilidade da contratação antes da elaboração do TR
- **Quando é obrigatório**: Contratações acima dos limites do art. 75 (dispensa)
- **Seções obrigatórias pelo sistema**:
  - Descrição da necessidade da contratação
  - Requisitos da contratação
  - Análise de mercado e alternativas
  - Estimativa de custos e benefícios
  - Análise de riscos
  - Declaração de viabilidade
- **Workflow padrão**: `draft → in_review → approved → archived`
- **Retenção**: `legal_7years`

### Edital
- **Código no sistema**: `edital`
- **Base legal**: Art. 25, Lei 14.133/2021
- **Finalidade**: Instrumento convocatório da licitação, com todas as regras do certame
- **Quando é obrigatório**: Todas as licitações formais
- **Seções obrigatórias pelo sistema**:
  - Identificação do órgão e do processo
  - Objeto da licitação
  - Condições de participação e habilitação
  - Critério de julgamento (menor preço, melhor técnica, etc.)
  - Prazos e datas
  - Minuta do contrato
  - Recursos e impugnações
- **Workflow padrão**: `draft → in_review → approved → archived`
- **Retenção**: `legal_permanent` (editais são documentos históricos permanentes)

### Contrato Administrativo
- **Código no sistema**: `contrato`
- **Base legal**: Art. 90, Lei 14.133/2021
- **Finalidade**: Formalizar o vínculo entre o órgão público e o contratado
- **Quando é obrigatório**: Toda contratação acima dos limites de dispensa
- **Seções obrigatórias pelo sistema**:
  - Qualificação das partes
  - Objeto e especificações
  - Valor total e forma de pagamento
  - Prazo de vigência
  - Obrigações das partes
  - Sanções e penalidades
  - Rescisão contratual
  - Foro competente
- **Workflow padrão**: `draft → in_review → approved → archived`
- **Retenção**: `legal_7years` (prazo prescricional geral)

---

## Workflow Documental

### Máquina de Estados

```
                  ┌─────────┐
                  │  DRAFT  │◄────────────────────────────┐
                  └────┬────┘                             │
                       │ submitForReview (manager+)        │
                  ┌────▼─────┐                            │
                  │ IN_REVIEW │                            │
                  └────┬─────┘                            │
           ┌───────────┼───────────┐                      │
    approve │           │ reject    │ (volta ao draft)     │
       (admin+)         │ (admin+)  └──────────────────────┘
           │            │
     ┌─────▼─────┐  ┌───▼────┐
     │ APPROVED  │  │REJECTED│
     └─────┬─────┘  └────────┘
           │ archive (admin+)
     ┌─────▼─────┐
     │ ARCHIVED  │
     └───────────┘
```

### Transições Permitidas
| De | Para | Papel Mínimo | Condição |
|---|---|---|---|
| draft | in_review | manager | Documento tem conteúdo mínimo |
| in_review | approved | admin | Sem comentários pendentes |
| in_review | rejected | admin | Comentário de rejeição obrigatório |
| rejected | draft | operator | — |
| approved | archived | admin | — |

---

## Pesquisa de Preços

### Base Legal
- Art. 23, Lei 14.133/2021 — Estimativa de valor da contratação
- IN SEGES/ME 65/2021 — Metodologia para pesquisa de preços em TI
- IN SEGES/ME 10/2020 — Pesquisa de preços para outros segmentos

### Fontes Aceitas pelo Sistema
1. **Painel de Preços do Governo Federal** (paineldeprecos.economia.gov.br)
2. **Atas de Registro de Preços vigentes**
3. **Notas fiscais de contratações anteriores** (< 1 ano)
4. **Cotações diretamente com fornecedores** (mínimo 3)
5. **Pesquisa em sítios eletrônicos** com justificativa

### Import Types no Sistema
- `price_research` — Planilha de pesquisa de preços (CSV/XLSX)
- `tr_items` — Itens do TR para normalização CATMAT
- `catmat` — Catálogo de materiais CATMAT direto
- `generic` — Qualquer planilha estruturada

---

## Glossário do Domínio

| Termo | Definição |
|---|---|
| **Licitação** | Procedimento administrativo para selecionar proposta mais vantajosa |
| **TR** | Termo de Referência — define o objeto da contratação |
| **ETP** | Estudo Técnico Preliminar — analisa viabilidade da contratação |
| **Pregão** | Modalidade licitatória para bens e serviços comuns |
| **PNCP** | Portal Nacional de Contratações Públicas |
| **CATMAT** | Catálogo de Materiais do Governo Federal |
| **CATSER** | Catálogo de Serviços do Governo Federal |
| **UASGs** | Unidades Administradoras de Serviços Gerais |
| **SRP** | Sistema de Registro de Preços |
| **ARP** | Ata de Registro de Preços |
| **Dispensa** | Contratação sem licitação em casos previstos em lei |
| **Inexigibilidade** | Contratação direta quando não é possível competição |

---

*Para segurança e RBAC: [docs/security/README.md](../security/README.md)*
*Para workflows técnicos: [docs/workflows/README.md](../workflows/README.md)*
