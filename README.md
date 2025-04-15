# 🧨 JJK RedenBOT - Bot de Segurança Avançada para Discord

![Licença](https://img.shields.io/github/license/viniprati/JJK-RedenBOT?label=License&logo=apache&logoColor=red&color=blue)
![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D16-green.svg)

> Bot completo de proteção, moderação automática e análise de comportamento para servidores Discord

---

## 📋 Sumário

- [🛡️ Recursos](#️recursos)
- [⚙️ Instalação](#instalação)
- [🔧 Configuração](#configuração)
- [⌨️ Comandos](#comandos)
- [📊 Dashboard](#dashboard)
- [📝 Registros](#registros)
- [💡 Recomendações](#recomendações)
- [📜 Licença](#licença)

---

## 🛡️ Recursos

### 🔐 Segurança Avançada
- Proteção contra raids com verificação de contas novas
- Anti-nuke (webhooks, canais, cargos, bans)
- Modo Lockdown automático e manual
- Proteção contra DDoS com bloqueio de IPs
- Reconexão automática com limite e espera progressiva
- Monitoramento de heartbeat para detecção de travamentos

### 🧠 Inteligência de Moderação
- Filtro de palavras banidas com base em IA
- Detecção de links suspeitos e scam
- Detecção de flood, spam e comportamento tóxico
- Sistema de reputação e análise de comportamento
- Ações automatizadas: timeout, ban, quarantine, softban

### 💾 Backup e Restauração
- Backups automáticos agendados
- Restauração via comando com 2FA opcional
- Histórico de restaurações e logs

### 📊 Dashboard Web Integrado
- API protegida com autenticação
- Acesso a logs, backups, métricas e configs
- Limite de IPs permitidos
- Visual amigável com rotas para análise de membros

---

## ⚙️ Instalação

### Pré-requisitos
- Node.js 16 ou superior
- Token de bot válido
- Cargo de administrador no servidor

```bash
# Clonar o projeto
git clone https://github.com/seu-usuario/JJK-RedenBOT.git
cd JJK-RedenBOT

# Instalar as dependências
npm install
```

---

## 🔧 Configuração

Crie e edite o arquivo `.env` com as seguintes variáveis:

```env
DISCORD_TOKEN=SEU_TOKEN_AQUI
DASHBOARD_SECRET=sua_chave_segura
DASHBOARD_ALLOWED_IPS=127.0.0.1
MAX_RECONNECT_ATTEMPTS=5
INITIAL_RECONNECT_DELAY_MS=5000
MAX_RECONNECT_DELAY_MS=60000
REQUEST_THRESHOLD=30
TIME_WINDOW_MS=60000
BLOCK_DURATION_MS=3600000
PROXY_LIST=http://proxy1.example.com:8080,http://proxy2.example.com:8080
PROXY_ROTATE_INTERVAL_MS=3600000
```

Você também pode personalizar palavras banidas, cargos confiáveis e configurações de ação dentro do painel ou via banco de dados.

---

## ⌨️ Comandos

| Comando        | Descrição                               | Permissão                |
|----------------|-------------------------------------------|---------------------------|
| `!lockdown`    | Ativa o modo de emergência (lockdown)    | Gerenciar Servidor        |
| `!unlock`      | Desativa o modo de emergência             | Gerenciar Servidor        |
| `/backup`      | Cria backup do servidor                   | Administrador             |
| `/restore`     | Restaura um backup com 2FA (se ativado)   | Administrador             |
| `/userinfo`    | Mostra reputação e perfil do usuário      | Todos                     |

---

## 📊 Dashboard

O painel web pode ser acessado localmente ou via VPS:

- Porta padrão: `3000`
- Autenticação via token `.env`
- Rotas:
  - `/api/config`
  - `/api/logs`
  - `/api/backups`
  - `/api/metrics`
  - `/api/user/:userId`

---

## 📝 Registros

Todos os eventos críticos são registrados no canal `#anti-raid-logs`, incluindo:

- 📆 Data e hora
- 👤 Usuário envolvido
- 🛡️ Ação aplicada
- 📄 Motivo e metadados
- 🔁 Tentativas de reconexão e erros de conexão

---

## 💡 Recomendações

1. Crie um cargo `Quarentena` e configure suas permissões
2. Crie o canal `#anti-raid-logs` para visualização dos eventos
3. Teste o bot em um servidor privado antes de usar em produção
4. Atualize regularmente o bot e revise as listas de banimento

---

## 📜 Licença

Este projeto está licenciado sob a **Apache License 2.0**. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.
---
