# Runbook — Onboarding da Prefeitura de Moreira Sales (PR A.1)
### LiciGov Pro · Onboarding de tenant via tela `/admin/organizacoes`

> O ID `700001` usado no corpus institucional (`server/services/officialCorpus/officialCorpusBuilder.ts`,
> `MOREIRA_SALES_TENANT_ID`) é **sintético** — criado para os testes/validações do RAG jurídico
> (RC-5.1 e sprints relacionadas), não é o tenant real de produção. O onboarding real de Moreira
> Sales acontece pela tela abaixo, sem nenhum hardcode de ID.

## Pré-requisitos

- `EMAIL_ENABLED=true` e Brevo configurado no ambiente (ver `docs/ops/EMAIL_BREVO_RUNBOOK.md`) —
  sem isto, o convite ao 1º administrador não sai.
- Um usuário com `role='admin'` (admin de **plataforma**, não confundir com papel de organização)
  autenticado no ambiente-alvo.
- Dado manual necessário: **nome e e-mail do primeiro administrador** da Prefeitura de Moreira
  Sales — é quem vai receber o convite institucional e criar a própria conta.

## Passo a passo

1. Login como admin de plataforma → menu lateral → **Organizações** (`/admin/organizacoes`).
2. Preencher o formulário "Cadastrar nova organização":
   - **Nome do órgão**: "Prefeitura Municipal de Moreira Sales" (ou razão social oficial).
   - **Identificador (slug)**: pré-preenchido a partir do nome (editável) — vira parte da
     identidade interna da organização, não muda depois sem migração manual.
   - **Esfera**: Municipal.
   - **UF**: PR. **Município**: Moreira Sales.
   - **CNPJ**: opcional, mas recomendado (evita ambiguidade se outro órgão tiver nome parecido).
   - **Primeiro administrador** — nome e e-mail do dado manual acima.
3. Clicar em **Criar organização**. O sistema:
   - Cria a organização (`organizations`).
   - Cria um convite `pending` com papel `owner` para o e-mail informado (`institutional_invitations`).
   - Enfileira o e-mail de convite (`email_outbox`) e o dispatcher envia em até
     `EMAIL_DISPATCH_INTERVAL_MS` (30s por padrão).
4. O destinatário recebe o e-mail, clica no link (`/convite?token=...`), define uma senha e cria
   a própria conta — a conta já nasce com papel `owner` na organização.
5. A partir daí, o próprio owner usa a tela **Usuários** (`/usuarios`) para convidar o restante
   da equipe (servidores do departamento de licitações), sem depender mais do admin de plataforma.

## Idempotência

Rodar o formulário de novo com o **mesmo** nome+CNPJ para um slug já existente **não duplica** a
organização — a tela mostra a mensagem `"<nome>" já existia — nenhuma alteração foi feita.` e
nenhum convite novo é enviado. Uma entrada **diferente** colidindo com um slug já usado é tratada
como conflito real (`TENANT_ALREADY_EXISTS`) — escolher outro slug.

## Se o e-mail de convite não chegar

Ver a seção "Investigar falha de entrega" em `docs/ops/EMAIL_BREVO_RUNBOOK.md`. Rapidamente:

```sql
SELECT status, lastErrorCode, lastErrorMessage
FROM email_outbox
WHERE recipient = '<e-mail do 1º administrador>'
ORDER BY createdAt DESC LIMIT 1;
```

## Nota sobre o ID 700001 do corpus

Se, por coincidência, o onboarding real produzir um `organizationId` que colida com IDs usados em
testes/smoke (faixa 700000+ ou 950000+), isso é apenas coincidência de auto-incremento — não há
acoplamento funcional entre o corpus de testes e o onboarding real. Nenhuma ação é necessária;
os dados de teste são limpos pelos próprios testes (`afterAll`) e nunca residem em produção.
