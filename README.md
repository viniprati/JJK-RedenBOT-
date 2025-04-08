# JJK RedenBOT - Bot de Segurança para Discord  

![Licença](https://img.shields.io/github/license/seu-usuario/JJK-RedenBOT)  
![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)  
![Node.js](https://img.shields.io/badge/node-%3E%3D16-green.svg)  

> Bot avançado de proteção contra raids e ataques para servidores Discord  

## 📋 Sumário  
- [Recursos](#-recursos)  
- [Instalação](#-instalação)  
- [Configuração](#-configuração)  
- [Comandos](#-comandos)  
- [Registros](#-registros)  
- [Recomendações](#-recomendações)  
- [Licença](#-licença)  

## 🛡️ Recursos  

### 🔒 Sistemas Principais  
- **Proteção contra Raids**  
  - Detecção de entrada em massa  
  - Lockdown automático  
  - Verificação de contas novas  

- **Anti-Nuke**  
  - Prevenção contra exclusão de canais  
  - Monitoramento de alterações de cargos  
  - Alerta de criação de webhooks  

- **Filtros de Conteúdo**  
  - Bloqueio de links maliciosos  
  - Filtro de palavras proibidas  
  - Detecção de menções em massa  

## ⚙️ Instalação  

### Pré-requisitos  
- Node.js 16+  
- Discord.js 14  
- Token de bot do Discord  

```bash 
# Clonar o repositório  
git clone https://github.com/seu-usuario/JJK-RedenBOT.git  

# Instalar dependências  
npm install  
```  

## 🔧 Configuração  

Edite o arquivo `config.js`:  

```javascript  
module.exports = {  
  TOKEN: 'SEU_TOKEN_AQUI',  
  SAFE_ROLES: ['Admin', 'Moderador'],  
  BANNED_WORDS: ['scam', 'phishing'],  
  LOG_CHANNEL: 'anti-raid-logs'  
};  
```  

## ⌨️ Comandos  

| Comando     | Descrição                  | Permissão Necessária |  
|------------|---------------------------|---------------------|  
| `!lockdown` | Ativa modo de emergência   | Gerenciar Servidor  |  
| `!unlock`   | Desativa o lockdown        | Gerenciar Servidor  |  
| `!status`   | Mostra status do sistema   | Todos               |  

## 📝 Registros  

Todos os eventos são registrados no canal `#anti-raid-logs` com:  
- Data e hora  
- Informações do usuário  
- Ação realizada  
- Motivo  

## 💡 Recomendações  

1. Crie um cargo `Quarentena` para contas suspeitas  
2. Configure um canal dedicado `#anti-raid-logs`  
3. Teste em um servidor de testes antes de usar em produção  
4. Atualize regularmente a lista de palavras banidas  

---

### Como Usar  
1. Renomeie `.env.example` para `.env` e preencha com suas informações  
2. Execute `node index.js` para iniciar o bot  
3. Configure as permissões do bot no servidor  


✏️ **Nota:** Substitua `seu-usuario` e `SEU_TOKEN_AQUI` pelas suas informações reais antes de usar.  
