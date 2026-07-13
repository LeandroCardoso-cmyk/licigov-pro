# Parecer Jurídico — Integração Cross-Domínio

## Princípio: nunca gerado neste módulo

O Business Domain **Contratação Direta NUNCA gera parecer jurídico**. A elaboração
de pareceres é responsabilidade exclusiva do Business Domain **Parecer Jurídico**.
A etapa `LEGAL_OPINION` deste domínio **solicita** e **disponibiliza** o parecer —
não o produz. Isso preserva o princípio de **reutilizar sem duplicar**.

## Integração via Institutional Request Engine

A integração ocorre pelo **Institutional Request Engine**, que padroniza pedidos
entre domínios. O fluxo:

1. na etapa `LEGAL_OPINION`, a operação `requestLegalOpinion` chama
   `requestInstitutionalReview`;
2. o engine cria uma **Institutional Request** do tipo `LEGAL_OPINION_INITIAL`,
   endereçada ao Business Domain Parecer Jurídico;
3. o request carrega as **referências** aos artefatos do processo (justificativas,
   documentação, fundamento legal) — por referência, nunca por cópia;
4. o workspace registra que aguarda o parecer.

```
Contratação Direta ──requestInstitutionalReview──▶ Institutional Request Engine
        │                    (LEGAL_OPINION_INITIAL)              │
        │                                                         ▼
        └────────── disponibilização automática ◀──── Business Domain Parecer Jurídico
```

## Aguardo e disponibilização automática

Após o envio do request, o workspace **aguarda** a resposta. Quando o Business
Domain Parecer Jurídico conclui o parecer, ele é **disponibilizado
automaticamente** ao processo de contratação direta:

- **sem upload** manual do parecer;
- **sem download** e reanexação;
- a operação `getLegalOpinion` lê o parecer diretamente da referência
  institucional.

O operador não faz movimentação de arquivos entre módulos — a plataforma cuida do
elo por referência.

## Configurabilidade

A etapa `LEGAL_OPINION` é **configurável** via flag (`legalOpinionRequired`, ver
`workflow.md`). Quando desabilitada para determinada modalidade/hipótese, o
Adaptive Process Engine **pula** a etapa, registrando o salto e a razão na
timeline. Reativar a flag reintroduz a etapa.

## Rastreabilidade

Cada solicitação e cada disponibilização de parecer geram registros no Timeline
Engine (`process_timeline`), preservando o histórico completo da tramitação
jurídica — quem solicitou, quando o request foi criado e quando o parecer ficou
disponível.

## Por que não duplicar

Centralizar a geração de pareceres no domínio próprio evita:

- divergência de versões do mesmo parecer entre módulos;
- retrabalho de elaboração;
- perda de rastreabilidade.

A Contratação Direta consome o parecer como **capacidade externa**, mantendo o
acoplamento por interface (Institutional Request Engine) e não por implementação.
