# 🚀 Guia de Configuração - GitHub Actions + Branch Protection

**Projeto:** LiciGov Pro  
**Tempo estimado:** 15 minutos  
**Pré-requisitos:** Repositório GitHub criado

---

## 📋 ÍNDICE

1. [Preparar Repositório](#1-preparar-repositório)
2. [Habilitar GitHub Actions](#2-habilitar-github-actions)
3. [Configurar Branch Protection](#3-configurar-branch-protection)
4. [Testar Configuração](#4-testar-configuração)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. PREPARAR REPOSITÓRIO

### 1.1. Criar Repositório no GitHub

1. Acesse https://github.com/new
2. Preencha:
   - **Repository name:** `licigov-pro`
   - **Description:** "Sistema de gestão de processos licitatórios - LiciGov Pro"
   - **Visibility:** Private (recomendado)
3. **NÃO** marque "Add a README file"
4. Clique em **"Create repository"**

### 1.2. Conectar Repositório Local

```bash
# No diretório do projeto
cd /home/ubuntu/licigov-pro

# Inicializar git (se ainda não foi feito)
git init

# Adicionar remote
git remote add origin https://github.com/SEU_USUARIO/licigov-pro.git

# Verificar remote
git remote -v
```

### 1.3. Fazer Primeiro Commit

```bash
# Adicionar todos os arquivos
git add .

# Commit inicial
git commit -m "feat: implementação completa das correções da auditoria técnica

- 26/27 problemas resolvidos (96%)
- 5/5 falhas críticas resolvidas
- 6 módulos criados
- 14 integrações ativas
- 19 testes automatizados (100% passando)
- CI/CD configurado
- 200+ páginas de documentação"

# Push para main
git branch -M main
git push -u origin main
```

**✅ Checkpoint:** Código agora está no GitHub!

---

## 2. HABILITAR GITHUB ACTIONS

### 2.1. Verificar Workflow

O workflow já está criado em `.github/workflows/ci.yml`. Verifique se o arquivo existe:

```bash
ls -la .github/workflows/ci.yml
```

Se não existir, o arquivo foi criado e está pronto para uso.

### 2.2. Habilitar Actions no Repositório

1. Acesse seu repositório no GitHub
2. Vá em **Settings** (⚙️ no topo)
3. No menu lateral, clique em **Actions** → **General**
4. Em "Actions permissions", selecione:
   - ✅ **"Allow all actions and reusable workflows"**
5. Em "Workflow permissions", selecione:
   - ✅ **"Read and write permissions"**
   - ✅ **"Allow GitHub Actions to create and approve pull requests"**
6. Clique em **"Save"**

### 2.3. Verificar Execução

1. Vá em **Actions** (aba no topo)
2. Você verá o workflow **"CI/CD - LiciGov Pro"** executando
3. Clique no workflow para ver detalhes
4. Aguarde conclusão (~2-3 minutos)

**Resultado Esperado:**
- ✅ **test** - Testes Automatizados (19/19 passando)
- ✅ **security** - Auditoria de Segurança
- ⚠️ **deploy** - Skipped (só executa em push para main)

### 2.4. Adicionar Badge ao README

Crie ou edite `README.md` no repositório:

```markdown
# LiciGov Pro

![CI/CD](https://github.com/SEU_USUARIO/licigov-pro/workflows/CI%2FCD%20-%20LiciGov%20Pro/badge.svg)

Sistema de gestão de processos licitatórios com conformidade total à Lei 14.133/2021.

## ✅ Status da Auditoria

- **26/27 problemas resolvidos (96%)**
- **5/5 falhas críticas resolvidas (100%)**
- **19 testes automatizados (100% passando)**
- **CI/CD configurado**

## 🧪 Testes

```bash
# Executar testes de auditoria
pnpm test:audit

# Executar todos os testes
pnpm test:ci
```

## 📚 Documentação

- [Auditoria Técnica Completa](./LiciGov_Pro_Auditoria_Tecnica.md)
- [Guia de Integração](./GUIA_INTEGRACAO_CORRECOES.md)
- [Relatório Final](./RELATORIO_FINAL_COMPLETO.md)
- [Configuração CI/CD](./.github/README.md)
```

**✅ Checkpoint:** GitHub Actions habilitado e funcionando!

---

## 3. CONFIGURAR BRANCH PROTECTION

### 3.1. Acessar Configurações de Branches

1. No repositório, vá em **Settings** (⚙️)
2. No menu lateral, clique em **Branches**
3. Em "Branch protection rules", clique em **"Add rule"** ou **"Add branch protection rule"**

### 3.2. Configurar Regra para Main

#### Nome do Branch
- **Branch name pattern:** `main`

#### Proteções Obrigatórias

Marque as seguintes opções:

**✅ Require a pull request before merging**
- Marque: ✅ **"Require approvals"** (mínimo 1)
- Marque: ✅ **"Dismiss stale pull request approvals when new commits are pushed"**

**✅ Require status checks to pass before merging**
- Marque: ✅ **"Require branches to be up to date before merging"**
- Na busca "Search for status checks", digite: **"Testes Automatizados"**
- Clique para adicionar o check
- Também adicione: **"Auditoria de Segurança"**

**✅ Require conversation resolution before merging**
- Força resolver todos os comentários antes de merge

**✅ Require linear history**
- Mantém histórico limpo (sem merge commits)

**✅ Do not allow bypassing the above settings**
- Nem admins podem ignorar as regras

#### Proteções Opcionais (Recomendadas)

**✅ Require deployments to succeed before merging**
- Se você configurar ambientes de staging

**✅ Lock branch**
- Apenas se quiser tornar main read-only (não recomendado para desenvolvimento ativo)

### 3.3. Salvar Configuração

1. Role até o final da página
2. Clique em **"Create"** ou **"Save changes"**

**✅ Checkpoint:** Branch protection configurado!

---

## 4. TESTAR CONFIGURAÇÃO

### 4.1. Criar Branch de Teste

```bash
# Criar nova branch
git checkout -b test/branch-protection

# Fazer uma alteração simples
echo "# Teste de Branch Protection" >> TEST.md
git add TEST.md
git commit -m "test: verificar branch protection"

# Push da branch
git push -u origin test/branch-protection
```

### 4.2. Criar Pull Request

1. No GitHub, você verá um banner **"Compare & pull request"**
2. Clique nele
3. Preencha:
   - **Title:** "test: verificar branch protection"
   - **Description:** "PR de teste para validar configuração"
4. Clique em **"Create pull request"**

### 4.3. Verificar Proteções

Você deve ver:

- ⏳ **Checks em execução** (Testes Automatizados + Auditoria)
- 🚫 **Merge bloqueado** até checks passarem
- ⚠️ **"Review required"** - precisa de aprovação

### 4.4. Aprovar e Fazer Merge

1. Aguarde checks passarem (✅)
2. Se você for o único desenvolvedor:
   - Clique em **"Merge pull request"**
   - Confirme o merge
3. Se tiver outro desenvolvedor:
   - Peça para ele revisar e aprovar
   - Depois faça o merge

### 4.5. Limpar Branch de Teste

```bash
# Voltar para main
git checkout main

# Atualizar main
git pull

# Deletar branch local
git branch -D test/branch-protection

# Deletar branch remota (opcional)
git push origin --delete test/branch-protection
```

**✅ Checkpoint:** Configuração testada e funcionando!

---

## 5. TROUBLESHOOTING

### Problema: "Actions not found"

**Causa:** Actions não habilitado  
**Solução:** Volte ao passo 2.2 e habilite Actions

### Problema: "Status checks not found"

**Causa:** Workflow ainda não executou  
**Solução:** 
1. Faça um push qualquer para main
2. Aguarde workflow executar
3. Volte às configurações de branch protection
4. Os checks aparecerão na busca

### Problema: "Cannot merge - checks failed"

**Causa:** Testes falharam  
**Solução:**
1. Clique em "Details" no check que falhou
2. Veja o log de erro
3. Corrija o código
4. Faça novo commit na mesma branch
5. Checks executarão automaticamente

### Problema: "Need approval but I'm the only developer"

**Solução:**
1. Volte em Settings → Branches
2. Edite a regra de main
3. Desmarque "Require approvals"
4. Ou adicione você mesmo como revisor

### Problema: "Workflow skipped"

**Causa:** Push direto em main (sem PR)  
**Solução:** Normal! Workflow só executa em:
- Push para main
- Pull requests para main

---

## 📊 CHECKLIST FINAL

Marque conforme concluir:

### GitHub Actions
- [ ] Repositório criado no GitHub
- [ ] Código enviado para GitHub
- [ ] Actions habilitado em Settings
- [ ] Workflow executou com sucesso
- [ ] Badge adicionado ao README

### Branch Protection
- [ ] Regra criada para branch `main`
- [ ] Status checks configurados
- [ ] Pull request obrigatório
- [ ] Aprovação configurada (se aplicável)
- [ ] Testado com PR de teste

### Validação
- [ ] Testes passando (19/19)
- [ ] Auditoria de segurança OK
- [ ] Não é possível fazer push direto em main
- [ ] PR sem aprovação é bloqueado
- [ ] PR com checks falhando é bloqueado

---

## 🎯 PRÓXIMOS PASSOS

Agora que GitHub Actions e Branch Protection estão configurados:

1. **Desenvolva com segurança:**
   ```bash
   # Sempre crie uma branch para mudanças
   git checkout -b feature/nova-funcionalidade
   
   # Faça suas alterações
   git add .
   git commit -m "feat: descrição da mudança"
   
   # Push e crie PR
   git push -u origin feature/nova-funcionalidade
   ```

2. **Monitore a qualidade:**
   - Acesse Actions regularmente
   - Verifique se testes estão passando
   - Corrija falhas imediatamente

3. **Mantenha documentação atualizada:**
   - Atualize README.md
   - Documente novas features
   - Mantenha changelog

---

## 📚 RECURSOS ADICIONAIS

- [Documentação GitHub Actions](https://docs.github.com/en/actions)
- [Documentação Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Guia de CI/CD](./.github/README.md)
- [Testes Automatizados](./server/services/__tests__/auditCorrections.test.ts)

---

**Status:** ✅ **CONFIGURAÇÃO COMPLETA**  
**Data:** 07/12/2024  
**Versão:** bf4e5eeb
