# Integração com o Parecer Jurídico

O Business Domain Contratos **não produz pareceres jurídicos**. Quando um instrumento
contratual exige análise jurídica, o domínio **solicita** o parecer ao Business Domain
**Parecer Jurídico**, por meio do **Institutional Request Engine** — nunca integrando
diretamente com aquele domínio.

Router: `requestLegalOpinion`

## Por que integração por solicitação (e não acoplamento)

- **Baixo acoplamento:** o domínio Contratos desconhece a implementação do Parecer Jurídico.
- **Sem duplicação:** o parecer é produzido e mantido no domínio de origem e apenas
  **referenciado** no Workspace.
- **Rastreabilidade:** cada solicitação e cada retorno ficam registrados na Timeline.

## Tipos de solicitação

| Institutional Request | Uso |
|---|---|
| `LEGAL_OPINION_INITIAL` | Parecer inicial — antes da consolidação do instrumento (ex.: viabilidade de um aditivo). |
| `LEGAL_OPINION_FINAL` | Parecer final — sobre a minuta já elaborada, antes do documento final. |

## Fluxo de integração

```
Instrumento precisa de parecer? (decisão do Adaptive Process Engine)
      │  sim
      ▼
requestLegalOpinion → Institutional Request Engine
      │   (LEGAL_OPINION_INITIAL / LEGAL_OPINION_FINAL)
      ▼
Business Domain Parecer Jurídico produz o parecer
      │
      ▼
Retorno disponibilizado AUTOMATICAMENTE no Workspace (aba Documentos)
```

### 1. Decisão adaptativa
A necessidade de parecer **não é fixa**. O **Adaptive Process Engine** decide, conforme o
tipo de instrumento (aditivo de valor, quantitativo, rescisão, etc.) e o contexto, se o
parecer é exigido e qual tipo (`INITIAL` ou `FINAL`).

### 2. Emissão da solicitação
O domínio Contratos emite a Institutional Request. **Não há chamada direta** ao domínio
Parecer Jurídico: a comunicação passa sempre pelo Institutional Request Engine, via
**Kernel Access Service**.

### 3. Aguardo e disponibilização automática
O Workspace **aguarda** a produção do parecer e o **disponibiliza automaticamente** quando
pronto. **Não há upload nem download manual** entre domínios: o resultado aparece por
referência na aba Documentos.

## O que a integração NÃO faz

- **Não copia** o conteúdo do parecer para dentro do domínio Contratos (referência, não cópia).
- **Não integra diretamente** com o domínio Parecer Jurídico — apenas via Institutional Request.
- **Não decide** o mérito jurídico: quem emite o parecer é o domínio competente; o copiloto
  Jurídico apenas **apoia**, supervisionado, sem decidir.

## Rastreabilidade

Cada `requestLegalOpinion`, seu tipo e o retorno correspondente são registrados pelo
**Timeline Engine**, garantindo a trilha de auditoria exigida pelas regras de
rastreabilidade do LiciGov Pro.
