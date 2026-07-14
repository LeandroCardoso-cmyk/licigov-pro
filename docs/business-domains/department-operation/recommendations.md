# Adaptive Recommendation no Centro de Operações

> O Centro de Operações **reutiliza** o **Adaptive Recommendation Engine** do Kernel para
> recomendar priorização, gargalos, riscos, sobrecarga e vencimentos. **O servidor sempre
> decide.**

## Princípio

O diferencial não é "gerar texto com IA": é **estruturar operacionalmente** o departamento
com inteligência, padronização e segurança. Portanto:

- Toda recomendação é **editável, revisável e validada por humano**.
- O **cliente nunca decide** — apenas apresenta o que o servidor determinou.
- Nenhuma recomendação toca temas fora de escopo (financeiro, contábil, orçamentário).

## Anatomia de uma recomendação

Toda recomendação carrega, obrigatoriamente:

| Campo | Descrição |
|---|---|
| `reasoning` | Por que a recomendação foi gerada |
| `confidence` | Grau de certeza |
| `legalBasis` | Fundamento na Lei 14.133/2021 **quando existir** |
| `impact` | Efeito esperado da ação |
| **alternativas** | Outros caminhos possíveis, sempre que houver |

Essa estrutura garante **explainability** total e alimenta a Timeline (Área 4).

## Categorias aplicadas ao domínio

### 1. Priorização
Ordena o que merece atenção primeiro, cruzando etapa atual, prazos e pendências do
departamento. Ex.: "Priorizar o Parecer Final do Processo X — sessão marcada para amanhã."

### 2. Gargalos
Identifica pontos de acúmulo no fluxo — muitas contratações paradas na mesma etapa
(ex.: Pesquisa de Preços), sinalizando um estrangulamento operacional.

### 3. Riscos
Aponta situações de risco operacional — marcos atrasados (Vermelho no Painel), pareceres
parados, contratos sem aditivo próximo do fim da vigência.

### 4. Sobrecarga
Detecta responsáveis com volume excessivo de tarefas/pendências simultâneas e sugere
redistribuição.

### 5. Próximos vencimentos
Antecipa vencimentos de contratos, aditivos e atas, coerente com os alertas escalonados
(90/60/30/15/7 dias) do Calendário Operacional.

## Fontes de sinal (por referência)

O motor consome dados **por referência** via Kernel Access Service — nunca cópias:

- Etapas e marcos do **Painel de Acompanhamento** (Área 2).
- Eventos e vencimentos do **Calendário Operacional** (Área 3).
- Pendências da **Caixa de Entrada** (Área 5).
- Estado dos Business Domains (Processo Licitatório, Contratação Direta, Contratos, Parecer).

## O que o motor NÃO recomenda

- **Nunca** cria licitações, contratos, pareceres, TRs ou editais — apenas **recomenda**.
- **Nunca** indicadores ou recomendações **financeiras**.
- **Nunca** decisões autônomas sem validação humana.

## Garantias

- **Multi-tenant**: recomendações calculadas dentro das fronteiras de cada departamento.
- **Replay-safe** (IDs `sha256`): reprocessar sinais não gera recomendações duplicadas.
- **Observabilidade**: cada recomendação apresentada é registrada na Timeline com `reasoning`,
  `confidence`, `legalBasis`, `impact` e alternativas.
