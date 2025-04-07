const { Client, GatewayIntentBits, Partials, AuditLogEvent, PermissionsBitField, ChannelType } = require('discord.js');
const backup = require('discord-backup');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User, Partials.Reaction],
});

const messageCache = new Map();
const userTimestamps = new Map();
const muteCount = new Map();
const recentJoins = [];
const TIMEOUT_DURATION = 2 * 60 * 60 * 1000;
const TIMEOUT_NEW_ACCOUNT = 7 * 24 * 60 * 60 * 1000;
const MAX_MUTES_BEFORE_BAN = 3;
const SAFE_ROLES = ['Admin', 'Mod'];
const bannedWords = ['scam', 'phishing', 'nword'];
const MAX_JOIN_RATE = 5;
const JOIN_INTERVAL = 10000;
const QUARANTINE_ROLE = 'Quarentena';
let isLockdownActive = false;

client.on('guildMemberAdd', async (member) => {
  const now = Date.now();
  recentJoins.push(now);
  while (recentJoins.length && now - recentJoins[0] > JOIN_INTERVAL) {
    recentJoins.shift();
  }
  if (recentJoins.length >= MAX_JOIN_RATE) {
    const logChannel = member.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    member.guild.channels.cache.forEach(channel => {
      if (channel.permissionsFor) {
        channel.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false });
      }
    });
    isLockdownActive = true;
    if (logChannel) logChannel.send('🚨 Lockdown ativado: muitos usuários entrando rapidamente.');
  }

  if (isLockdownActive) {
    await member.kick('Servidor em lockdown');
    return;
  }

  const accountAge = Date.now() - member.user.createdAt;
  if (accountAge < 7 * 24 * 60 * 60 * 1000) {
    await member.timeout(TIMEOUT_NEW_ACCOUNT, 'Conta muito nova - possível bot').catch(() => {});
    const logChannel = member.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`⚠️ ${member.user.tag} mutado por conta ter menos de 1 semana.`);
  }

  if (member.user.bot) {
    const logs = await member.guild.fetchAuditLogs({
      type: AuditLogEvent.BotAdd,
      limit: 1
    });
    const entry = logs.entries.first();
    
    if (!entry || entry.executor.bot || !member.guild.members.cache.get(entry.executor.id)?.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
      await member.kick('Bot adicionado sem autorização').catch(() => {});
      const logChannel = member.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
      if (logChannel) logChannel.send(`🤖 Bot ${member.user.tag} removido por falta de autorização.`);
    }
  }

  const suspiciousNamePatterns = [
    /discord\.gg\/\w+/i,
    /nitro/i,
    /free/i,
    /giveaway/i,
    /http?s:\/\//i,
    /[^\w\sáéíóúãõâêîôûàèìòùäëïöüç]/i
  ];
  
  if (suspiciousNamePatterns.some(pattern => pattern.test(member.user.username))) {
    await member.kick('Nome suspeito').catch(() => {});
    const logChannel = member.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`👤 ${member.user.tag} kickado por nome suspeito: ${member.user.username}`);
  }

  const suspiciousCriteria = (
    member.user.avatar === null ||
    member.user.username.toLowerCase().includes('discord') || 
    member.user.createdAt > Date.now() - 86400000
  );
  
  if (suspiciousCriteria) {
    const quarantineRole = member.guild.roles.cache.find(r => r.name === QUARANTINE_ROLE);
    if (quarantineRole) {
      await member.roles.add(quarantineRole).catch(() => {});
      const logChannel = member.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
      if (logChannel) logChannel.send(`⚠️ ${member.user.tag} colocado em quarentena por critérios suspeitos.`);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const content = message.content.trim();
  const now = Date.now();

  if (message.content.toLowerCase() === '!lockdown') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;
    message.guild.channels.cache.forEach(channel => {
      if (channel.permissionsFor) {
        channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      }
    });
    isLockdownActive = true;
    message.delete().catch(() => {});
    message.channel.send('🔒 Lockdown ativado!');
    return;
  }

  if (message.content.toLowerCase() === '!unlock') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;
    message.guild.channels.cache.forEach(channel => {
      if (channel.permissionsFor) {
        channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
      }
    });
    isLockdownActive = false;
    message.delete().catch(() => {});
    message.channel.send('🔓 Lockdown desativado!');
    return;
  }

  if (message.content.toLowerCase() === '!status') {
    const joinRate = recentJoins.length;
    const lockdownStatus = isLockdownActive ? 'ativado' : 'desativado';
    message.reply(`📊 Anti-raid status:\n- Entradas recentes: ${joinRate}\n- Lockdown: ${lockdownStatus}`);
    return;
  }

  const member = await message.guild.members.fetch(userId).catch(() => null);
  if (!member || member.roles.cache.some(r => SAFE_ROLES.includes(r.name))) return;

  if (/\.ru|\.zip|discord\.gift/.test(content)) {
    await message.delete().catch(() => {});
    await member.timeout(TIMEOUT_DURATION, 'Link suspeito').catch(() => {});
    const logChannel = message.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`🔗 ${member} mutado por link suspeito.`);
    return;
  }

  if (bannedWords.some(word => content.toLowerCase().includes(word))) {
    await message.delete().catch(() => {});
    await member.timeout(TIMEOUT_DURATION, 'Palavra proibida').catch(() => {});
    const logChannel = message.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`🚫 ${member} mutado por usar palavra proibida.`);
    return;
  }

  if (message.mentions.users.size > 5 || message.mentions.everyone) {
    await message.delete().catch(() => {});
    await member.timeout(TIMEOUT_DURATION, 'Mass ping detectado').catch(() => {});
    const logChannel = message.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`📢 ${member} mutado por mass ping.`);
    return;
  }

  if (message.mentions.members.size > 0) {
    const mentionPercentage = message.mentions.members.size / message.guild.memberCount;
    if (mentionPercentage > 0.3) {
      await message.delete().catch(() => {});
      await member.timeout(TIMEOUT_DURATION, 'Mention raid detectada').catch(() => {});
      const logChannel = message.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
      if (logChannel) logChannel.send(`@here ⚠️ Mention raid detectada de ${member.user.tag}!`);
    }
  }

  if (!messageCache.has(userId)) messageCache.set(userId, []);
  const userMessages = messageCache.get(userId);
  userMessages.push(content);
  if (userMessages.length > 5) userMessages.shift();
  const repeated = userMessages.filter(m => m === content).length;

  if (!userTimestamps.has(userId)) userTimestamps.set(userId, []);
  const timestamps = userTimestamps.get(userId);
  timestamps.push(now);
  const recent = timestamps.filter(t => now - t < 5000);
  userTimestamps.set(userId, recent);

  if (repeated >= 3 || recent.length >= 5) {
    if (member.communicationDisabledUntilTimestamp > Date.now()) return;

    const logChannel = message.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    await member.timeout(TIMEOUT_DURATION, 'Spam ou flood detectado').catch(() => {});
    if (logChannel) logChannel.send(`🚨 ${member} mutado por spam/flood.`);

    const count = (muteCount.get(userId) || 0) + 1;
    muteCount.set(userId, count);
    if (count >= MAX_MUTES_BEFORE_BAN) {
      await member.ban({ reason: 'Excesso de spam/flood após múltiplos timeouts.' }).catch(() => {});
      if (logChannel) logChannel.send(`🔨 ${member.user.tag} foi banido por reincidência.`);
      muteCount.delete(userId);
    }

    messageCache.delete(userId);
    userTimestamps.delete(userId);
  }
});

client.on('webhookUpdate', async (channel) => {
  const fetchedLogs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 });
  const log = fetchedLogs.entries.first();
  if (!log) return;
  const executor = log.executor;
  const member = await channel.guild.members.fetch(executor.id).catch(() => null);
  if (member && !member.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
    await member.timeout(TIMEOUT_DURATION, 'Criação de webhook não autorizada').catch(() => {});
    const logChannel = channel.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`🪝 ${executor.tag} mutado por criar webhook.`);
  }
});

client.on('channelDelete', async (channel) => {
  const fetchedLogs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
  const log = fetchedLogs.entries.first();
  if (!log) return;
  const executor = log.executor;
  const member = await channel.guild.members.fetch(executor.id).catch(() => null);
  if (member && !member.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
    await member.timeout(TIMEOUT_DURATION, 'Tentativa de nuke - exclusão de canal').catch(() => {});
    const logChannel = channel.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`🛑 ${executor.tag} mutado por excluir canal.`);
  }
});

client.on('guildBanAdd', async (ban) => {
  const fetchedLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
  const log = fetchedLogs.entries.first();
  if (!log) return;
  const executor = log.executor;
  const member = await ban.guild.members.fetch(executor.id).catch(() => null);
  if (member && !member.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
    await member.timeout(TIMEOUT_DURATION, 'Banimento não autorizado').catch(() => {});
    const logChannel = ban.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`🚫 ${executor.tag} mutado por banir membro sem permissão.`);
  }
});

client.on('guildMemberRemove', async (member) => {
  const fetchedLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
  const log = fetchedLogs.entries.first();
  if (!log) return;
  const executor = log.executor;
  const kickedMember = log.target;
  if (kickedMember.id !== member.id) return;
  const mod = await member.guild.members.fetch(executor.id).catch(() => null);
  if (mod && !mod.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
    await mod.timeout(TIMEOUT_DURATION, 'Kick não autorizado').catch(() => {});
    const logChannel = member.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`👢 ${executor.tag} mutado por kick não autorizado.`);
  }
});

client.on('guildAuditLogEntryCreate', async (entry) => {
  const actionTypes = [
    AuditLogEvent.MemberBanAdd,
    AuditLogEvent.MemberKick,
    AuditLogEvent.MemberUpdate
  ];
  
  if (actionTypes.includes(entry.actionType)) {
    const logs = await entry.guild.fetchAuditLogs({
      type: entry.actionType,
      limit: 5
    });
    
    const recentActions = logs.entries.filter(e => 
      Date.now() - e.createdTimestamp < 10000 && 
      e.executor.id !== client.user.id
    );
    
    if (recentActions.size >= 3) {
      const executor = await entry.guild.members.fetch(recentActions.first().executor.id);
      if (!executor.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
        await executor.timeout(TIMEOUT_DURATION, 'Ações em massa detectadas').catch(() => {});
        const logChannel = entry.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
        if (logChannel) logChannel.send(`⚠️ ${executor.user.tag} mutado por realizar múltiplas ações em pouco tempo.`);
      }
    }
  }
});

client.on('roleCreate', async (role) => {
  const logs = await role.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleCreate,
    limit: 1
  });
  const entry = logs.entries.first();
  if (!entry) return;
  
  const member = await role.guild.members.fetch(entry.executor.id);
  if (!member.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
    await member.timeout(TIMEOUT_DURATION, 'Criação suspeita de cargo').catch(() => {});
    await role.delete().catch(() => {});
    const logChannel = role.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`🎭 ${member.user.tag} mutado por criar cargo suspeito.`);
  }
});

client.on('roleDelete', async (role) => {
  const logs = await role.guild.fetchAuditLogs({
    type: AuditLogEvent.RoleDelete,
    limit: 1
  });
  const entry = logs.entries.first();
  if (!entry) return;
  
  const member = await role.guild.members.fetch(entry.executor.id);
  if (!member.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
    await member.timeout(TIMEOUT_DURATION, 'Exclusão suspeita de cargo').catch(() => {});
    const logChannel = role.guild.channels.cache.find(c => c.name === 'anti-raid-logs');
    if (logChannel) logChannel.send(`🎭 ${member.user.tag} mutado por excluir cargo suspeito.`);
  }
});

client.on('channelCreate', async (channel) => {
  if (channel.type === ChannelType.GuildText) {
    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelCreate,
      limit: 1
    });
    const entry = logs.entries.first();
    
    if (entry && !entry.executor.bot) {
      const member = await channel.guild.members.fetch(entry.executor.id);
      if (!member.roles.cache.some(r => SAFE_ROLES.includes(r.name))) {
        backup.create(channel.guild, {
          jsonBeautify: true
        }).then((backupData) => {
          console.log(`Backup criado: ${backupData.id}`);
        });
      }
    }
  }
});

client.login('SEU_TOKEN_DO_BOT');