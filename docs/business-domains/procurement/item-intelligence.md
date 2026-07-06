# Item Intelligence Workspace — O Diferencial Competitivo

> O **Item Intelligence Workspace** é a **principal funcionalidade** do Processo
> Licitatório e o **maior diferencial competitivo** do LiciGov Pro.

## 1. Por que é o diferencial

Sistemas comuns tratam itens como linhas de planilha. Aqui, **cada item vira uma
entidade inteligente** — o `IntelligentProcurementItem` — enriquecida por
copilotos, memória institucional, CATMAT/CATSER, histórico do município e
Knowledge Graph. O servidor **revisa e aprova cada item individualmente** antes
que ele entre no TR.

O diferencial não é gerar texto — é **estruturar tecnicamente cada item** com
inteligência operacional, padronização e segurança jurídica.

## 2. A entidade `IntelligentProcurementItem`

| Campo | Descrição |
|---|---|
| `description` | Descrição do item |
| `quantity` | Quantidade |
| `unit` | Unidade de medida |
| `averagePrice` | Preço médio calculado da pesquisa |
| `suppliers` | Fornecedores identificados |
| `suggestedCATMAT` | CATMAT/CATSER sugerido (ranking #1) |
| `alternativeCATMAT` | Alternativas de CATMAT/CATSER |
| `specifications` | Especificações técnicas sugeridas |
| `risks` | Riscos identificados (direcionamento, excesso, falta) |
| `recommendations` | Recomendações dos copilotos |
| `status` | Estado do item (rascunho, enriquecido, aprovado…) |
| `approvedBy` | Servidor que aprovou o item |

## 3. O painel lateral do item — os 13 blocos

Ao abrir um item, o painel lateral apresenta 13 blocos de inteligência:

1. **Pesquisa usada** — quais fontes de preço alimentaram o item.
2. **Histórico do município** — compras anteriores relacionadas.
3. **Compras semelhantes** — casos análogos (interno e institucional).
4. **CATMAT sugerido** — código recomendado, com confidence.
5. **Alternativas** — outros CATMAT/CATSER candidatos e ranking.
6. **Especificações** — mínimas e equivalentes sugeridas.
7. **Alertas** — sinais dos copilotos (não bloqueiam).
8. **Riscos** — direcionamento, excesso, falta, preço fora da curva.
9. **Cláusulas** — cláusulas sugeridas ligadas ao item.
10. **Justificativas** — fundamentação das sugestões.
11. **Knowledge Graph** — relações do item no grafo institucional.
12. **Reasoning** — a cadeia de raciocínio que gerou cada recomendação.
13. **Explainability** — explicação legível do porquê de cada sugestão.

Todo bloco é alimentado **via `kernelAccessService`** — nunca acessando
providers, RAG ou KG diretamente.

## 4. Enriquecimento do item

O enriquecimento ocorre no `itemIntelligenceRouter`, coordenado pelo
**Multi-Copilot Orchestrator**:

```
item bruto (da Pesquisa de Preços)
        │
        ▼
 kernelAccessService  ──▶  RAG + Knowledge Graph + memória + copilotos
        │
        ▼
IntelligentProcurementItem enriquecido
 (preço médio, CATMAT, alternativas, especificações, riscos, alertas)
```

Cada saída carrega **reasoning, explainability, provenance e confidence**.

## 5. Aprovação individual antes do TR

Nenhum item entra no TR sem aprovação humana explícita:

- O servidor revisa cada bloco do painel.
- Pode **aceitar**, **ajustar**, **rejeitar** ou **pedir nova análise**.
- Ao aprovar, o item recebe `approvedBy` e muda de `status`.
- Apenas itens **aprovados** compõem o TR Inteligente.

> O sistema nunca aprova itens automaticamente. Nunca escolhe CATMAT sozinho.
> Nunca oculta a justificativa de uma sugestão.

## 6. Alertas — copilotos que explicam, nunca bloqueiam

Os copilotos sinalizam automaticamente:

- direcionamento;
- baixa competitividade;
- CATMAT inadequado;
- especificação excessiva;
- preço fora da curva;
- inconsistências entre campos.

Todo alerta **explica** o motivo e **nunca bloqueia** o servidor. A decisão
final é sempre humana.

## 7. Rastreabilidade

Cada enriquecimento, alerta, ajuste e aprovação de item é registrado na
**Timeline append-only**, com o reasoning e a explainability associados,
preservando provenance e confidence para auditoria.
