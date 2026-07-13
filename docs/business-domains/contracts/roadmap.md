# Roadmap — Evolução Futura (NÃO implementado)

Este documento lista a **evolução futura** do Business Domain Contratos. **Nenhum** dos itens
abaixo está implementado no Production Ready Core (Fase 5). Onde há preparação, existem
apenas **interfaces e pontos de extensão** — a lógica de negócio ainda não foi construída.

> **Aviso:** tudo nesta página é *Future Evolution*. Não assuma disponibilidade destas
> capacidades. O núcleo atual foca **exclusivamente na geração inteligente de documentos
> contratuais**.

## Biblioteca de conhecimento contratual
- Biblioteca de **cláusulas** reutilizáveis.
- Biblioteca de **contratos** modelo.
- Biblioteca de **aditivos** modelo.
- Biblioteca de **apostilamentos** modelo.

*Status:* não implementado. A tabela `contract_templates` oferece um ponto de extensão inicial.

## Inteligência comparativa e sugestiva
- **Comparação entre contratos** (diffs semânticos, benchmarking de cláusulas).
- **Sugestão automática de cláusulas** com base em histórico e contexto.

*Status:* não implementado. Existem apenas os ganchos de *reasoning/provenance* das minutas.

## Integrações externas
- **Integração PNCP** (Portal Nacional de Contratações Públicas) — publicação/consulta.
- **Integração ERP** — troca de dados com sistemas financeiros/orçamentários do órgão.
- **Integração e-mail** — notificações e envio de documentos.

*Status:* não implementado. Apenas pontos de extensão previstos; **nenhuma** integração ativa.
Reforço: o LiciGov Pro **não é ERP** — a integração ERP seria apenas troca de dados, nunca
absorção dessas responsabilidades.

## Gestão de ciclo de vida
- **Alerta de vencimento** de contratos.
- **Renovação sugerida** automaticamente.

*Status:* não implementado.

## Visualização e analytics
- **Dashboard contratual** (visão consolidada da carteira de contratos).
- **Analytics** de contratos, instrumentos e prazos.

*Status:* não implementado.

## Assinatura digital
- **ICP-Brasil**.
- **GOV.BR**.
- **Certificado A1**.

*Status:* não implementado. A geração de DOCX/PDF via Document Engine é o ponto onde a
assinatura digital se conectaria no futuro.

## Resumo do que existe hoje vs. futuro

| Capacidade | Hoje (Fase 5) | Futuro |
|---|---|---|
| Geração de minutas (contrato/aditivo/apostilamento/rescisão) | ✅ | — |
| 3 fluxos de nascimento (licitação, direta, externo) | ✅ | — |
| Integração Parecer Jurídico via Institutional Request | ✅ | — |
| Biblioteca de cláusulas / comparação / sugestão automática | ❌ | ✅ |
| Integração PNCP / ERP / e-mail | ❌ | ✅ |
| Alerta de vencimento / renovação sugerida | ❌ | ✅ |
| Dashboard / analytics contratual | ❌ | ✅ |
| Assinatura digital (ICP-Brasil / GOV.BR / A1) | ❌ | ✅ |

## Princípio de evolução

Toda evolução futura deve **preservar** os invariantes do núcleo: foco exclusivo em
documentação contratual (não ERP), multi-tenant, determinismo/replay-safety, reuso do Kernel
via Kernel Access Service e **revisão humana obrigatória** sobre toda saída de IA.
