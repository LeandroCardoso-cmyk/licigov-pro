# copilotEvaluationService — Avaliação e melhoria

## Responsabilidade

O `copilotEvaluationService` mede a **qualidade** das recomendações dos copilotos e
alimenta o **loop de melhoria** institucional. Ele avalia cada `copilotRecommendation`
quanto a qualidade, confiança, aderência às políticas e feedback humano — sem jamais
substituir a supervisão humana.

## O que é avaliado

Para cada recomendação, o serviço computa dimensões objetivas e rastreáveis:

- **Qualidade** — completude, clareza e coerência com o contexto fundamentado;
- **Confiança** — nível de confiança declarado pelo reasoning e sua calibração;
- **Aderência às políticas** — conformidade com `copilotPolicy` (`evaluatePolicy`);
- **Grounding** — proporção de afirmações com evidência no lineage do trace;
- **Feedback do usuário** — avaliação humana (aprovação/rejeição, notas, correções).

## Métricas de recomendação

Métricas consolidadas por copiloto e por organização (`organizationId`):

| Métrica | Descrição |
|---|---|
| Taxa de aprovação | recomendações aprovadas / total submetido à Approval Layer |
| Taxa de rejeição | recomendações rejeitadas e seus motivos |
| Cobertura de grounding | fração de afirmações com evidência no trace |
| Confiança média | confiança declarada vs. desfecho humano |
| Taxa de conflito | recomendações escaladas por divergência |
| Aderência a políticas | avaliações sem violação / total |

As métricas derivam de dados já rastreáveis: `copilotRecommendation`,
`copilotDecisionTrace` e o audit trail de governança. Identificadores de avaliação são
determinísticos (**SHA-256**), garantindo reprodutibilidade.

## Fontes de sinal

- **copilotDecisionTrace** — steps, lineage e evidências para medir grounding;
- **Approval Layer** — decisão humana (aprovado/rejeitado) e justificativas;
- **feedback explícito** — notas e correções do usuário no Copilot Center;
- **replay** — divergências no replay indicam instabilidade a investigar.

## Loop de melhoria

A avaliação fecha o ciclo de aprimoramento contínuo:

1. **coleta** — sinais de qualidade, confiança e feedback são agregados por copiloto;
2. **diagnóstico** — identifica padrões de rejeição, baixa cobertura de grounding ou
   confiança mal calibrada;
3. **ajuste** — informa melhorias no `PromptContextBuilder`, na recuperação do RAG, nos
   caminhos do Knowledge Graph e nas políticas;
4. **verificação** — novas recomendações são reavaliadas, comparando métricas antes e
   depois.

O loop é **institucional e auditável**: não há autoajuste opaco do modelo. Ajustes
passam por revisão humana e ficam registrados, preservando a rastreabilidade.

## Relação com confiança e supervisão

Confiança alta **não** dispensa aprovação humana. A avaliação apenas prioriza atenção:
recomendações de baixa confiança, baixo grounding ou histórico de rejeição são
sinalizadas para revisão mais criteriosa na Approval Layer.

## Garantias

- **determinismo (SHA-256)** nas avaliações e métricas;
- **multi-tenant** — métricas isoladas por `organizationId`;
- **correlationId** ligando avaliação, recomendação e trace;
- **replay safety** — avaliações reproduzíveis a partir dos mesmos insumos.

## Degradação graciosa

Sem banco (padrão `getDb()`), a avaliação opera sobre os dados em memória da sessão
corrente, sem persistir métricas históricas. As métricas agregadas retomam quando o DB
volta a estar disponível; nenhuma decisão depende da avaliação estar online.

## Uso no Copilot Center

No Institutional Copilot Center, a avaliação é exposta em painéis por copiloto:

- **placar de qualidade** — métricas agregadas do período;
- **recomendações a revisar** — itens de baixa confiança ou baixo grounding;
- **evolução** — tendência das métricas após ajustes do loop de melhoria.

Os painéis são somente informativos para gestão da qualidade; não substituem a
Approval Layer nem antecipam decisões.

## Boas práticas

- avaliar sempre no escopo da `organizationId` — não comparar organizações distintas;
- tratar confiança como **sinal de priorização**, nunca como autorização;
- versionar ajustes do loop de melhoria para permitir comparação antes/depois;
- correlacionar métricas ao `copilotDecisionTrace` para diagnosticar causas-raiz.

## Referências

- `docs/copilots/explainability.md` — trace, lineage e replay
- `docs/copilots/governance.md` — sinais da Approval Layer
- `docs/copilots/roadmap.md` — evolução para aprendizado com feedback
