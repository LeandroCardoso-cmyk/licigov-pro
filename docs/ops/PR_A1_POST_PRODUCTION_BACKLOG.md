# Backlog de refinamentos pós-produção — PR A.1 (Acesso Institucional)

> Itens identificados durante a homologação da PR #187 (mesclada em `main` via squash `e50aa87`).
> **NÃO implementados nesta PR** — registrados aqui como backlog para uma iteração futura.
> Todos são refinamentos de UX/copy/segurança incremental; nenhum é bloqueante.

## Recuperação de senha (UX)

1. **Placeholder do e-mail** em `EsqueciSenha.tsx` → `usuario@orgao.gov.br` (hoje `seu@email.com.br`),
   alinhando ao padrão já aplicado no convite (`Usuarios.tsx`).
2. **Refinar os textos** da recuperação de senha (copy mais institucional em `EsqueciSenha.tsx` /
   `RedefinirSenha.tsx`).
3. **Contraste/destaque do link "Voltar para o login"** — hoje é um link discreto; melhorar
   hierarquia visual.
4. **Tela de sucesso após redefinição de senha**, SEM login automático — hoje o `RedefinirSenha`
   redireciona direto para `/login`; criar uma tela de confirmação explícita ("Senha redefinida
   com sucesso — faça login com a nova senha") antes do login.

## E-mails transacionais

5. **Pequenos refinamentos de copy** nos e-mails transacionais (convite, reset, senha alterada) —
   revisão editorial fina, mantendo a identidade visual atual.

## Política de senha

6. **Evoluir a política de senha** — complexidade configurável e indicadores visuais de força
   (o scoring `validatePasswordStrength` já existe em `services/passwordSecurity.ts`, mas não é
   aplicado por nenhum fluxo). Decisão de produto: o piso atual de 8 caracteres é preexistente e
   consistente em todos os fluxos (register/reset/aceite); elevar o piso global é parte deste item.

## UX geral

7. **Demais refinamentos visuais de UX** identificados na homologação (alinhamentos, espaçamentos,
   estados de foco/hover, responsividade fina) — varredura visual em staging pelo operador.

## Itens de auditoria (não bloqueantes, backlog técnico)

- Emitir `invitation.expired` (hoje a expiração é preguiçosa, sem job de expiração).
- Auditar tentativas bloqueadas (`LAST_TENANT_ADMIN`, conflito de onboarding).
- Consolidar/remover o `emailService.ts` legado (Resend, órfão e já depreciado).
- Implementar as ações "Editar usuário" (menu ⋮) e demais placeholders estruturados na tela de
  Usuários.
