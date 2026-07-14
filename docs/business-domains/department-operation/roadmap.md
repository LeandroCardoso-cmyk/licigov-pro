# Roadmap — Future Evolution

> **Importante:** nada nesta página está implementado. São capacidades de **evolução futura**
> para as quais a **arquitetura já está preparada** — mas que **não** fazem parte do
> Production Ready Core do Business Domain 5.

## Status

| Item | Situação |
|---|---|
| Todas as capacidades abaixo | **NÃO implementado** — apenas arquitetura preparada |

O Centro de Operações foi desenhado como camada **consolidadora por referência**, com IDs
determinísticos (`sha256`), multi-tenant e replay-safe. Essa base torna as integrações
abaixo viáveis no futuro **sem** reescrever o núcleo.

## Integrações de calendário

- **Google Calendar** — sincronização de eventos operacionais (sessões, reuniões,
  vencimentos) com agendas Google.
- **Apple Calendar** — integração equivalente para o ecossistema Apple.
- **Outlook Calendar** — integração com Microsoft 365 / Outlook.
- **ICS Export** — exportação padrão `.ics` dos eventos do Calendário Operacional, permitindo
  assinatura de agenda em qualquer cliente compatível.

> Todas partem do mesmo modelo de **eventos ≠ workflow**: apenas eventos de agenda seriam
> exportados; publicações, checklists e documentos permaneceriam no workflow.

## Business Intelligence e análise

- **Power BI** — conectores para leitura consolidada (operacional, nunca financeira).
- **Grafana** — painéis de observabilidade operacional do departamento.
- **Analytics** — camada analítica de produtividade e fluxo operacional.

> **Restrição permanente:** mesmo em evolução futura, **nenhuma** métrica financeira,
> contábil, orçamentária ou patrimonial será exposta. O escopo continua **operacional**.

## Experiência e personalização

- **Dashboard Personalizado** — permitir que cada departamento configure blocos e indicadores
  operacionais da Área 1.
- **Notificações Push** — alertas de vencimento, pendências e recomendações entregues em
  tempo real (web/push), complementando os alertas escalonados (90/60/30/15/7 dias).
- **App Mobile** — acesso móvel ao Centro de Operações, Painel, Calendário e Caixa de Entrada.

## Princípios preservados na evolução

Qualquer item deste roadmap, quando implementado, deverá manter os invariantes do domínio:

1. **Não-ERP** — jamais financeiro, contábil, tributário, patrimonial, folha, almoxarifado ou
   execução orçamentária.
2. **Consolidação por referência** — nunca duplicar dados dos Business Domains.
3. **Multi-tenant** e **replay-safe** (IDs `sha256`).
4. **Explainability e observabilidade** — rastreabilidade via Timeline.
5. **Validação humana** — recomendações sempre editáveis, revisáveis e validadas.

## Fora de escopo (permanente)

Não são roadmap e **nunca** serão propostos: ERP municipal, sistema contábil/financeiro,
tributário, RH/folha, patrimonial, almoxarifado, pagamentos, execução orçamentária ou
qualquer indicador financeiro.
