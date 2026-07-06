# CATMAT / CATSER — Sugestão Inteligente, Decisão Humana

> Regra absoluta: o sistema **nunca substitui o CATMAT automaticamente**. Ele
> pesquisa, faz matching, ranqueia e apresenta alternativas — **o servidor
> escolhe**.

## 1. O que são CATMAT e CATSER

- **CATMAT** — Catálogo de Materiais.
- **CATSER** — Catálogo de Serviços.

Ambos são catálogos oficiais do Governo Federal, consultados via API pública
(`https://dadosabertos.compras.gov.br`), sem autenticação:

- CATMAT: `GET /modulo-material/4_consultarItemMaterial?descricaoItem=X`
- CATSER: `GET /modulo-servico/6_consultarItemServico?descricaoItem=X`

## 2. O fluxo: pesquisa → matching → ranking → alternativas → servidor escolhe

```
descrição do item
      │
      ▼
 ┌──────────┐   pesquisa nos catálogos oficiais
 │ PESQUISA │   (CATMAT/CATSER via dadosabertos.compras.gov.br)
 └────┬─────┘
      ▼
 ┌──────────┐   correlaciona descrição ↔ candidatos
 │ MATCHING │   (semântica + memória institucional via kernelAccessService)
 └────┬─────┘
      ▼
 ┌──────────┐   ordena candidatos por aderência + confidence
 │ RANKING  │
 └────┬─────┘
      ▼
 ┌──────────────┐  apresenta o #1 sugerido + alternativas
 │ ALTERNATIVAS │
 └──────┬───────┘
        ▼
 ┌──────────────────┐
 │ SERVIDOR ESCOLHE │  aceitar / rejeitar / pesquisar de novo / manual
 └──────────────────┘
```

Todo o acesso a inferência e memória ocorre **via `kernelAccessService`**.

## 3. As quatro ações sempre disponíveis

Para cada sugestão de CATMAT/CATSER, o servidor **sempre** pode:

1. **Aceitar** — adota o código sugerido.
2. **Rejeitar** — descarta a sugestão (com registro do motivo).
3. **Pesquisar de novo** — refina a descrição e reexecuta a busca.
4. **Informar manual** — insere um código escolhido diretamente.

Nenhuma dessas ações é executada pelo sistema sem comando do servidor.

## 4. Sugerido e alternativas no item inteligente

Cada `IntelligentProcurementItem` guarda:

- `suggestedCATMAT` — o candidato #1 do ranking, com confidence e reasoning.
- `alternativeCATMAT` — os demais candidatos ranqueados.

O painel lateral do item exibe ambos, com a justificativa de cada posição do
ranking, garantindo **explainability** e **provenance**.

## 5. Por que nunca é automático

- Um CATMAT inadequado pode **direcionar** ou **restringir** a competição.
- A escolha tem consequências jurídicas — precisa de decisão consciente.
- O copiloto pode **alertar** sobre CATMAT inadequado, mas **nunca bloqueia** e
  **nunca troca** o código sozinho.

> O sistema conduz e explica. O servidor decide.

## 6. Registro e rastreabilidade

Cada pesquisa, matching, sugestão, aceite, rejeição e escolha manual é gravada
na **Timeline append-only**, com reasoning, explainability, provenance e
confidence. Isso permite auditar por que determinado CATMAT foi adotado em um
processo.

## 7. Integração via Kernel

O domínio **não** chama a API de catálogos nem o RAG/KG diretamente para o
matching semântico. Toda recuperação e inferência passa pelo
`kernelAccessService`, que orquestra a consulta aos catálogos, o matching
assistido por IA (pipeline oficial `server/_core/llm.ts`) e a memória
institucional.
