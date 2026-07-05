# Roadmap — Copilotos Cognitivos Institucionais

## Estado atual (Sprint 4.9)

A **primeira geração** dos Copilotos Cognitivos Institucionais está **entregue**: os 8
copilotos especializados operando sobre o pipeline oficial, com governança, políticas,
explicabilidade e avaliação.

**Copilotos entregues:**

- `agente_contratacao` — coordenação do fluxo DFD → ETP → TR → Edital
- `pregoeiro` — sessão pública e atos do certame
- `planejamento` — planejamento, DFD, ETP, calendário
- `tr_intelligence` — elaboração e revisão de Termo de Referência
- `juridico` — fundamentação e identificação de riscos legais
- `pesquisa_precos` — pesquisa de preços e cesta de referência
- `contratos` — contratos, aditivos e reaproveitamento processual
- `controle_interno` — conformidade e checklists de controle

**Fundações consolidadas:** pipeline oficial (`server/_core/llm.ts`), Institutional
RAG, Procurement Knowledge Graph, Semantic Memory, Workflow Engine, Approval Layer,
IDs determinísticos (SHA-256), multi-tenant (`organizationId`), replay safety e
degradação graciosa (padrão `getDb()`).

## Próximas gerações

### 2ª geração — Copilotos cooperativos multi-agente

Evolução da cooperação supervisionada atual para **colaboração multi-agente** mais
rica: copilotos negociando subtarefas, compondo recomendações complexas e resolvendo
trade-offs de forma explícita — sempre sob **supervisão humana** e sem tomar decisões
jurídicas. Coordenação orquestrada, conflitos escalados e trace consolidado por todos
os agentes envolvidos.

### 3ª geração — Memória de longo prazo

Ampliação da Semantic Memory para **memória institucional de longo prazo**: padrões
processuais recorrentes, decisões anteriores da organização e precedentes reutilizáveis
— tudo escopado por `organizationId` e auditável. A memória fundamenta, mas não decide;
segue sujeita ao grounding obrigatório e ao lineage do trace.

### 4ª geração — Aprendizado com feedback

Fechamento do **loop de melhoria** descrito em `evaluation.md` de forma sistemática:
uso do feedback humano (aprovações, rejeições, correções) para calibrar recuperação do
RAG, caminhos do Knowledge Graph e montagem de contexto. O aprendizado é
**institucional e revisável** — nunca autoajuste opaco do modelo — preservando
rastreabilidade e replay safety.

### Novos domínios

Expansão do catálogo de copilotos para além do core licitatório, acompanhando o
roadmap funcional do produto:

- **Contratação Direta** — dispensa, inexigibilidade;
- **Credenciamento** — estruturação e condução;
- **Parecer** — apoio à instrução (fundamentação, nunca parecer definitivo);
- **Gestão contratual avançada** — reequilíbrio, prorrogações, indicadores.

Cada novo domínio nasce com **política de escopo** própria (`copilotPolicy`), dentro
dos limites do produto — sem propor features de ERP, contabilidade, tributação ou RH.

## Visão — Sistema Operacional Cognitivo

A trajetória consolida a transição do LiciGov Pro de **infraestrutura documental** para
um **Sistema Operacional Cognitivo** do departamento de licitações: uma camada
inteligente que orienta, estrutura e fundamenta toda a contratação pública.

O princípio permanece constante em todas as gerações:

> Os copilotos orientam, estruturam, sugerem, explicam, fundamentam e identificam
> riscos. **Toda decisão permanece humana**, revisável e auditável.

## Princípios inegociáveis ao evoluir

- inferência **somente** pelo pipeline oficial (`server/_core/llm.ts`);
- uso obrigatório das camadas institucionais (RAG, Knowledge Graph, Semantic Memory,
  Workflow Engine, Provider Layer, Approval Layer);
- determinismo (SHA-256), multi-tenant, replay safety e degradação graciosa;
- supervisão humana obrigatória; nenhum parecer jurídico definitivo por copiloto;
- rastreabilidade completa (logs, auditoria, trace) em cada nova capacidade.

## Linha do tempo (síntese)

| Geração | Foco | Estado |
|---|---|---|
| 1ª | 8 copilotos especializados + fundações | Entregue (Sprint 4.9) |
| 2ª | Cooperação multi-agente supervisionada | Planejado |
| 3ª | Memória institucional de longo prazo | Planejado |
| 4ª | Aprendizado com feedback (loop institucional) | Planejado |
| — | Novos domínios (contratação direta, credenciamento) | Contínuo |

Cada geração é incremental e retrocompatível: nenhuma evolução remove garantias de
determinismo, rastreabilidade ou supervisão humana já estabelecidas.

## Referências

- `docs/copilots/architecture.md` — visão geral e camadas
- `docs/copilots/evaluation.md` — loop de melhoria
- `docs/copilots/governance.md` — supervisão humana e auditoria
