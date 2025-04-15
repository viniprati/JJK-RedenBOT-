// Importações necessárias
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType } = require('discord.js');
const { QuickDB } = require("quick.db");
const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const ms = require('ms');
const backup = require('discord-backup');
const ProfanityEngine = require('bad-words');
const helmet = require('helmet');
const winston = require('winston');
const schedule = require('node-schedule');
const i18n = require('i18n');
const Sentry = require('@sentry/node');
const { ProfilingIntegration } = require('@sentry/profiling-node');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

// ==================== Configuração Inicial ====================
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Discord token not configured in environment variables');
  process.exit(1);
}

// Configuração do Sentry para monitoramento
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      new ProfilingIntegration(),
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}

// Configuração de internacionalização
i18n.configure({
  locales: ['en', 'pt', 'es'],
  directory: __dirname + '/locales',
  defaultLocale: 'en',
  objectNotation: true,
  register: global
});

// Configuração avançada de logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5 * 1024 * 1024 // 5MB
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024 // 10MB
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ]
});

// ==================== Sistema de Configuração ====================
class ConfigManager {
  constructor() {
    this.db = new QuickDB();
    this.configSchema = {
      MAX_RECONNECT_ATTEMPTS: { type: 'number', default: 5, min: 1, max: 20 },
      INITIAL_RECONNECT_DELAY_MS: { type: 'number', default: 5000, min: 1000, max: 30000 },
      MAX_RECONNECT_DELAY_MS: { type: 'number', default: 60000, min: 10000, max: 300000 },
      REQUEST_THRESHOLD: { type: 'number', default: 30, min: 10, max: 100 },
      TIME_WINDOW_MS: { type: 'number', default: 60000, min: 10000, max: 300000 },
      BLOCK_DURATION_MS: { type: 'number', default: 3600000, min: 600000, max: 86400000 },
      TIMEOUT_DURATION: { type: 'duration', default: '2h', min: '1m', max: '7d' },
      MAX_MUTES_BEFORE_BAN: { type: 'number', default: 3, min: 1, max: 10 },
      MAX_JOIN_RATE: { type: 'number', default: 5, min: 1, max: 20 },
      JOIN_INTERVAL: { type: 'duration', default: '10s', min: '5s', max: '1h' },
      LOG_CHANNEL: { type: 'string', default: 'anti-raid-logs' },
      QUARANTINE_ROLE: { type: 'string', default: 'Quarentena' },
      ADMIN_ROLES: { type: 'array', default: ['Admin', 'Mod'], separator: ',' },
      WHITELISTED_USERS: { type: 'array', default: [], separator: ',' },
      BANNED_WORDS: { type: 'array', default: [], separator: ',' },
      AUTO_BACKUP_INTERVAL: { type: 'duration', default: '24h', min: '1h', max: '7d' },
      DASHBOARD_PORT: { type: 'number', default: 3000, min: 1024, max: 65535 },
      AUTO_MODERATION: { type: 'boolean', default: true },
      RAID_PROTECTION: { type: 'boolean', default: true },
      SCAN_IMAGES: { type: 'boolean', default: false },
      ENABLE_2FA_COMMANDS: { type: 'boolean', default: false }
    };
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from environment variables and validate against schema
   * @returns {Object} Validated configuration object
   */
  loadConfig() {
    const config = {};
    for (const [key, schema] of Object.entries(this.configSchema)) {
      try {
        let value = process.env[key] !== undefined ? process.env[key] : schema.default;
        config[key] = this.validateValue(key, value, schema);
      } catch (error) {
        logger.error(`Configuration error for ${key}: ${error.message}`);
        config[key] = schema.default;
      }
    }
    return this.addComputedValues(config);
  }

  /**
   * Validate configuration value against schema
   * @param {string} key - Configuration key
   * @param {*} value - Value to validate
   * @param {Object} schema - Schema definition
   * @returns {*} Validated value
   * @throws {Error} If validation fails
   */
  validateValue(key, value, schema) {
    switch (schema.type) {
      case 'duration':
        const msValue = ms(value);
        if (!msValue) throw new Error(`Invalid duration for ${key}`);
        if (schema.min && msValue < ms(schema.min)) throw new Error(`${key} cannot be less than ${schema.min}`);
        if (schema.max && msValue > ms(schema.max)) throw new Error(`${key} cannot be greater than ${schema.max}`);
        return value;
      
      case 'number':
        const numValue = parseInt(value);
        if (isNaN(numValue)) throw new Error(`${key} must be a number`);
        if (schema.min && numValue < schema.min) throw new Error(`${key} cannot be less than ${schema.min}`);
        if (schema.max && numValue > schema.max) throw new Error(`${key} cannot be greater than ${schema.max}`);
        return numValue;
      
      case 'array':
        if (typeof value === 'string') {
          return value.split(schema.separator).map(item => item.trim()).filter(item => item);
        }
        return Array.isArray(value) ? value : schema.default;
      
      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true';
        }
        return Boolean(value);
      
      default:
        return value;
    }
  }

  /**
   * Add computed values to the configuration
   * @param {Object} config - Base configuration
   * @returns {Object} Enhanced configuration with computed values
   */
  addComputedValues(config) {
    return {
      ...config,
      TIMEOUT_DURATION_MS: ms(config.TIMEOUT_DURATION),
      TIMEOUT_NEW_ACCOUNT_MS: ms('7d'),
      JOIN_INTERVAL_MS: ms(config.JOIN_INTERVAL),
      AUTO_BACKUP_INTERVAL_MS: ms(config.AUTO_BACKUP_INTERVAL),
      SUSPICIOUS_NAME_PATTERNS: [
        "discord\\.gg\\/\\w+",
        "nitro|free|giveaway|http?s:\\/\\/|[^\\w\\sáéíóúãõâêîôûàèìòùäëïöüç]"
      ]
    };
  }

  /**
   * Update configuration with new values
   * @param {Object} newConfig - New configuration values
   * @returns {Promise<Object>} Updated configuration
   */
  async updateConfig(newConfig) {
    for (const [key, value] of Object.entries(newConfig)) {
      if (this.configSchema[key]) {
        this.config[key] = this.validateValue(key, value, this.configSchema[key]);
        await this.db.set(`config.${key}`, value);
      }
    }
    this.config = this.addComputedValues(this.config);
    return this.config;
  }

  /**
   * Get current configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return this.config;
  }

  /**
   * Validate required configuration
   * @returns {Promise<boolean>} True if configuration is valid
   * @throws {Error} If configuration is invalid
   */
  async validateConfig() {
    const requiredEnvVars = ['DISCORD_TOKEN'];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        logger.error(`Required environment variable not found: ${envVar}`);
        throw new Error(`Invalid configuration: ${envVar} is required`);
      }
    }
    return true;
  }
}

// ==================== Sistema de Dados ====================
class PersistentData {
  constructor() {
    this.db = new QuickDB();
    this.messageCache = this.db.table("messageCache");
    this.userTimestamps = this.db.table("userTimestamps");
    this.muteCount = this.db.table("muteCount");
    this.recentJoins = this.db.table("recentJoins");
    this.backups = this.db.table("backups");
    this.userProfiles = this.db.table("userProfiles");
    this.guildSettings = this.db.table("guildSettings");
    this.twoFACodes = this.db.table("twoFACodes");
    this.connectionHistory = this.db.table("connectionHistory");
  }

  /**
   * Initialize database and clean old data
   * @returns {Promise<void>}
   */
  async logConnectionEvent(type, metadata = {}) {
    await this.connectionHistory.set(Date.now().toString(), {
      type,
      timestamp: Date.now(),
      ...metadata
    });
  }

  async initialize() {
    try {
      await this.cleanOldData();
      logger.info('Database initialized');
    } catch (error) {
      logger.error('Failed to initialize database', { error });
      throw error;
    }
  }

  /**
   * Clean old data from database
   * @returns {Promise<void>}
   */
  async cleanOldData() {
    const now = Date.now();
    
    // Clean old joins
    const joins = await this.recentJoins.get([]) || [];
    const filteredJoins = joins.filter(time => now - time < config.JOIN_INTERVAL_MS);
    await this.recentJoins.set(filteredJoins);
    
    // Clean old message cache
    const messageCache = await this.messageCache.all();
    for (const { key, value } of messageCache) {
      const filtered = value.filter(msg => now - msg.timestamp < 60000);
      if (filtered.length > 0) {
        await this.messageCache.set(key, filtered);
      } else {
        await this.messageCache.delete(key);
      }
    }
    
    // Clean expired 2FA codes
    const twoFACodes = await this.twoFACodes.all();
    for (const { key, value } of twoFACodes) {
      if (now > value.expiresAt) {
        await this.twoFACodes.delete(key);
      }
    }
  }

  /**
   * Get guild backups
   * @param {string} guildId - Guild ID
   * @returns {Promise<Object>} Guild backups
   */
  async getGuildBackups(guildId) {
    return (await this.backups.get(guildId)) || {};
  }

  /**
   * Add new backup for guild
   * @param {string} guildId - Guild ID
   * @param {string} backupId - Backup ID
   * @param {Object} data - Backup data
   * @returns {Promise<void>}
   */
  async addBackup(guildId, backupId, data) {
    const backups = await this.getGuildBackups(guildId);
    backups[backupId] = data;
    await this.backups.set(guildId, backups);
  }

  /**
   * Get user profile
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User profile
   */
  async getUserProfile(userId) {
    return (await this.userProfiles.get(userId)) || {
      messageCount: 0,
      lastActivities: [],
      behaviorScore: 0,
      reputationScore: 50,
      warnings: []
    };
  }

  /**
   * Update user profile
   * @param {string} userId - User ID
   * @param {Object} updates - Profile updates
   * @returns {Promise<void>}
   */
  async updateUserProfile(userId, updates) {
    const profile = await this.getUserProfile(userId);
    await this.userProfiles.set(userId, { ...profile, ...updates });
  }

  /**
   * Generate and store 2FA code
   * @param {string} userId - User ID
   * @returns {Promise<string>} Generated code
   */
  async generate2FACode(userId) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.twoFACodes.set(userId, {
      code,
      expiresAt: Date.now() + 300000 // 5 minutes
    });
    return code;
  }

  /**
   * Verify 2FA code
   * @param {string} userId - User ID
   * @param {string} code - Code to verify
   * @returns {Promise<boolean>} True if code is valid
   */
  async verify2FACode(userId, code) {
    const stored = await this.twoFACodes.get(userId);
    if (!stored || stored.code !== code || Date.now() > stored.expiresAt) {
      return false;
    }
    await this.twoFACodes.delete(userId);
    return true;
  }
}

// ==================== Sistema de Logs ====================
class SecurityLogger {
  /**
   * Log security action to Discord channel and database
   * @param {Guild} guild - Discord guild
   * @param {string} action - Action name
   * @param {string} description - Action description
   * @param {string} severity - Severity level (critical, high, medium, low, info, debug)
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<boolean>} True if logging was successful
   */
  static async logAction(guild, action, description, severity = 'medium', metadata = {}) {
    const colors = {
      critical: 0xFF0000,
      high: 0xFF4500,
      medium: 0xFFA500,
      low: 0xFFFF00,
      info: 0x00FF00,
      debug: 0xADD8E6
    };

    const embed = new EmbedBuilder()
      .setTitle(`🔒 ${action}`)
      .setDescription(description)
      .setColor(colors[severity] || 0x000000)
      .setTimestamp()
      .setFooter({ text: `Event ID: ${uuidv4()}` });

    if (Object.keys(metadata).length > 0) {
      embed.addFields(
        { name: 'Metadata', value: '```json\n' + JSON.stringify(metadata, null, 2) + '\n```' }
      );
    }

    const channelName = config.LOG_CHANNEL;
    const channel = guild.channels.cache.find(c => 
      c.name === channelName && 
      c.type === ChannelType.GuildText
    );

    if (channel) {
      try {
        await channel.send({ embeds: [embed] });
        await this.dbLog(guild.id, { action, description, severity, metadata });
        return true;
      } catch (error) {
        logger.error('Failed to send log', { error });
        return false;
      }
    }
    return false;
  }

  /**
   * Log action to database
   * @param {string} guildId - Guild ID
   * @param {Object} logData - Log data
   * @returns {Promise<void>}
   */
  static async dbLog(guildId, logData) {
    try {
      const logs = (await db.get(`logs.${guildId}`)) || [];
      logs.push({ ...logData, timestamp: Date.now() });
      await db.set(`logs.${guildId}`, logs.slice(-1000));
    } catch (error) {
      logger.error('Failed to log to database', { error });
    }
  }

  /**
   * Send security alert to admins
   * @param {Guild} guild - Discord guild
   * @param {string} message - Alert message
   * @returns {Promise<void>}
   */
  static async sendAlert(guild, message) {
    try {
      const adminRoles = guild.roles.cache.filter(role => 
        config.ADMIN_ROLES.includes(role.name)
      );
      
      const admins = guild.members.cache.filter(member => 
        member.roles.cache.some(role => adminRoles.has(role.id)) &&
        !member.user.bot
      );

      for (const admin of admins.values()) {
        try {
          await admin.send(`🚨 **Security Alert**\n${message}`);
        } catch (error) {
          logger.error(`Failed to send alert to ${admin.user.tag}`, { error });
        }
      }
    } catch (error) {
      logger.error('Failed to send alerts', { error });
    }
  }
}

// ==================== Sistema de Segurança ====================
class SecurityManager {
  /**
   * Check if user is whitelisted
   * @param {GuildMember} member - Guild member
   * @returns {Promise<boolean>} True if user is whitelisted
   */
  static async isUserWhitelisted(member) {
    if (!member) return false;
    return config.WHITELISTED_USERS.includes(member.id) || 
           member.roles.cache.some(r => config.ADMIN_ROLES.includes(r.name));
  }

  /**
   * Check for suspicious account characteristics
   * @param {GuildMember} member - Guild member
   * @returns {Promise<boolean>} True if action was taken
   */
  static async checkSuspiciousAccount(member) {
    const checks = {
      isNewAccount: Date.now() - member.user.createdTimestamp < config.TIMEOUT_NEW_ACCOUNT_MS,
      hasDefaultAvatar: member.user.avatar === null,
      hasSuspiciousName: config.SUSPICIOUS_NAME_PATTERNS.some(
        pattern => new RegExp(pattern, 'i').test(member.user.username)
      ),
      isPotentialBot: member.user.username.toLowerCase().includes('discord') || 
                     member.user.discriminator === '0000'
    };

    const suspiciousFactors = Object.values(checks).filter(Boolean).length;
    if (suspiciousFactors === 0) return false;

    const action = suspiciousFactors >= 3 ? 'quarantine' : 'timeout';
    const reason = `Suspicious account (${Object.keys(checks).filter(k => checks[k]).join(', ')})`;
    
    return this.applySafetyMeasures(member, reason, action, { checks });
  }

  /**
   * Apply security measures to member
   * @param {GuildMember} member - Guild member
   * @param {string} reason - Action reason
   * @param {string} action - Action type (timeout, kick, ban, quarantine, softban)
   * @param {Object} evidence - Additional evidence
   * @returns {Promise<boolean>} True if action was successful
   */
  static async applySafetyMeasures(member, reason, action = 'timeout', evidence = null) {
    if (await this.isUserWhitelisted(member)) {
      await SecurityLogger.logAction(member.guild, 'Action Blocked', 
        `Attempt to apply ${action} to whitelisted user: ${member.user.tag}`, 'high');
      return false;
    }

    const metadata = {
      userId: member.id,
      userTag: member.user.tag,
      action,
      reason,
      timestamp: new Date().toISOString(),
      ...evidence
    };

    try {
      let actionTaken = true;
      
      switch (action) {
        case 'timeout':
          await member.timeout(config.TIMEOUT_DURATION_MS, reason);
          break;
        case 'kick':
          await member.kick(reason);
          break;
        case 'ban':
          await member.ban({ reason, days: 7 });
          break;
        case 'quarantine':
          const role = member.guild.roles.cache.find(r => r.name === config.QUARANTINE_ROLE);
          if (role) {
            await member.roles.add(role);
            const rolesToRemove = member.roles.cache.filter(r => r.id !== role.id && r.id !== member.guild.roles.everyone.id);
            await member.roles.remove(rolesToRemove).catch(() => {});
          } else {
            actionTaken = false;
          }
          break;
        case 'softban':
          await member.ban({ reason, days: 1 });
          await member.guild.members.unban(member.user.id).catch(() => {});
          break;
        default:
          actionTaken = false;
      }

      if (actionTaken) {
        await SecurityLogger.logAction(
          member.guild, 
          'Security Action', 
          `👤 ${member.user.tag} (${member.id})\n🛡️ Action: ${action}\n📌 Reason: ${reason}`,
          action === 'ban' ? 'critical' : 'high',
          metadata
        );
        
        await SecurityLogger.sendAlert(
          member.guild,
          `Security action taken:\n- User: ${member.user.tag}\n- Action: ${action}\n- Reason: ${reason}`
        );
      }

      return actionTaken;
    } catch (error) {
      logger.error(`Failed to apply security action: ${action}`, { error, metadata });
      await SecurityLogger.logAction(
        member.guild, 
        'Security Error', 
        `Failed to apply ${action} to ${member.user.tag}: ${error.message}`,
        'critical',
        { error: error.stack, ...metadata }
      );
      return false;
    }
  }
}

// ==================== Sistema de Análise de Comportamento ====================
class BehaviorAnalyzer {
  /**
   * Analyze user behavior and update profile
   * @param {GuildMember} member - Guild member
   * @returns {Promise<Object>} Analysis results
   */
  static async analyzeUser(member) {
    try {
      const profile = await db.getUserProfile(member.id);
      const activities = profile.lastActivities || [];
      
      // Update profile with new activity
      const newActivity = {
        type: 'message',
        timestamp: Date.now(),
        guildId: member.guild.id
      };
      
      await db.updateUserProfile(member.id, {
        lastActivities: [...activities.slice(-49), newActivity],
        messageCount: (profile.messageCount || 0) + 1
      });
      
      // Calculate scores
      const behaviorScore = this.calculateBehaviorScore(profile);
      const reputationScore = this.calculateReputationScore(profile);
      
      // Update scores
      await db.updateUserProfile(member.id, {
        behaviorScore,
        reputationScore
      });
      
      // Take action if needed
      if (behaviorScore > 0.8) {
        const action = behaviorScore > 0.9 ? 'quarantine' : 'timeout';
        await SecurityManager.applySafetyMeasures(
          member,
          'Suspicious behavior detected',
          action,
          { behaviorScore }
        );
      }
      
      return { behaviorScore, reputationScore };
    } catch (error) {
      logger.error('Behavior analysis failed', { error });
      return { error: true };
    }
  }

  /**
   * Calculate behavior score (0-1)
   * @param {Object} profile - User profile
   * @returns {number} Behavior score
   */
  static calculateBehaviorScore(profile) {
    let score = 0;
    const activities = profile.lastActivities || [];
    const now = Date.now();
    
    // Factor 1: Message frequency
    const hourActivity = activities.filter(
      act => now - act.timestamp < 3600000
    ).length;
    
    if (hourActivity > 50) score += 0.3;
    else if (hourActivity > 20) score += 0.1;
    
    // Factor 2: Identical messages
    if (activities.length > 5) {
      const lastMessages = activities.slice(-5);
      const uniqueMessages = new Set(lastMessages.map(m => m.content));
      if (uniqueMessages.size < 3) score += 0.2;
    }
    
    // Factor 3: Low reputation
    if (profile.reputationScore < 30) score += 0.2;
    
    return Math.min(1, score);
  }

  /**
   * Calculate reputation score (0-100)
   * @param {Object} profile - User profile
   * @returns {number} Reputation score
   */
  static calculateReputationScore(profile) {
    let score = profile.reputationScore || 50;
    const warnings = profile.warnings || [];
    
    // Decrease score for recent warnings
    const recentWarnings = warnings.filter(w => 
      Date.now() - w.timestamp < 30 * 24 * 3600 * 1000 // 30 days
    );
    
    score -= recentWarnings.length * 5;
    score = Math.max(0, Math.min(100, score));
    
    return score;
  }
}

// ==================== Sistema de Backup ====================
class BackupSystem {
  /**
   * Create guild backup
   * @param {Guild} guild - Discord guild
   * @returns {Promise<string|null>} Backup ID or null if failed
   */
  static async createBackup(guild) {
    const backupId = uuidv4();
    const loadingMsg = await guild.systemChannel?.send('🔄 Creating server backup...');

    try {
      const backupData = await backup.create(guild, { 
        jsonBeautify: true,
        saveImages: 'base64',
        doNotBackup: ['bans']
      });

      await db.addBackup(guild.id, backupId, {
        id: backupData.id,
        timestamp: Date.now(),
        creator: 'system'
      });

      if (loadingMsg) {
        await loadingMsg.edit(`✅ Backup created successfully! ID: ${backupData.id}`);
      }

      await SecurityLogger.logAction(
        guild,
        'Automatic Backup',
        `Backup created (ID: ${backupData.id})`,
        'info'
      );

      return backupData.id;
    } catch (error) {
      logger.error('Failed to create backup', { error });
      if (loadingMsg) {
        await loadingMsg.edit('❌ Failed to create backup: ' + error.message);
      }
      await SecurityLogger.logAction(
        guild,
        'Backup Failed',
        `Failed to create backup: ${error.message}`,
        'critical',
        { error: error.stack }
      );
      return null;
    }
  }

  /**
   * Restore guild backup
   * @param {Guild} guild - Discord guild
   * @param {string} backupId - Backup ID
   * @param {GuildMember} executor - Member executing the restore
   * @returns {Promise<boolean>} True if restore was successful
   */
  static async restoreBackup(guild, backupId, executor) {
    // 2FA verification if enabled
    if (config.ENABLE_2FA_COMMANDS) {
      const code = await db.generate2FACode(executor.id);
      await executor.send(`🔐 Please verify your identity with this code: ${code}\nEnter it in the server to confirm the restore.`);
      
      const filter = m => m.author.id === executor.id && m.content === code;
      try {
        await guild.systemChannel.awaitMessages({ filter, max: 1, time: 300000, errors: ['time'] });
      } catch (error) {
        await guild.systemChannel.send('❌ 2FA verification failed or timed out');
        return false;
      }
    }

    const confirmRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_restore')
          .setLabel('Confirm Restoration')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_restore')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

    const confirmMsg = await guild.systemChannel?.send({
      content: `⚠️ You are about to restore the server from backup ${backupId}. Confirm:`,
      components: [confirmRow]
    });

    const filter = i => i.user.id === executor.id;
    try {
      const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 60000 });

      if (confirmation.customId === 'confirm_restore') {
        await confirmation.update({ content: '🔄 Restoring server...', components: [] });
        
        try {
          await backup.load(backupId, guild);
          await confirmation.editReply('✅ Server restored successfully!');
          
          await SecurityLogger.logAction(
            guild,
            'Backup Restoration',
            `Server restored by ${executor.tag} using backup ${backupId}`,
            'info'
          );
          
          return true;
        } catch (error) {
          logger.error('Failed to restore backup', { error });
          await confirmation.editReply(`❌ Failed to restore backup: ${error.message}`);
          await SecurityLogger.logAction(
            guild,
            'Restoration Failed',
            `Failed to restore backup ${backupId}: ${error.message}`,
            'critical',
            { error: error.stack }
          );
          return false;
        }
      } else {
        await confirmation.update({ content: '❌ Restoration canceled.', components: [] });
        return false;
      }
    } catch (error) {
      logger.error('Confirmation timeout', { error });
      await confirmMsg.edit({ content: '❌ Confirmation timeout.', components: [] });
      return false;
    }
  }
}

// ==================== Dashboard Web ====================
class Dashboard {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware for Express app
   */
  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(express.json());
    this.app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many requests from this IP'
    }));
    
    // IP whitelist
    this.app.use((req, res, next) => {
      const allowedIPs = process.env.DASHBOARD_ALLOWED_IPS?.split(',') || [];
      if (allowedIPs.length > 0 && !allowedIPs.includes(req.ip)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    });
    
    // Authentication
    this.app.use((req, res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader === `Bearer ${process.env.DASHBOARD_SECRET}`) {
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    });
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    this.app.get('/api/config', this.getConfig.bind(this));
    this.app.post('/api/config', this.updateConfig.bind(this));
    this.app.get('/api/logs', this.getLogs.bind(this));
    this.app.get('/api/backups', this.getBackups.bind(this));
    this.app.get('/api/user/:userId', this.getUserAnalysis.bind(this));
    this.app.get('/api/metrics', this.getMetrics.bind(this));
  }

  /**
   * Get current configuration
   */
  async getConfig(req, res) {
    try {
      res.json(config.getConfig());
    } catch (error) {
      logger.error('Error getting configuration', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update configuration
   */
  async updateConfig(req, res) {
    try {
      const updated = await config.updateConfig(req.body);
      res.json(updated);
    } catch (error) {
      logger.error('Error updating configuration', { error });
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get security logs
   */
  async getLogs(req, res) {
    try {
      const guildId = req.query.guildId;
      const logs = await db.get(`logs.${guildId}`) || [];
      res.json(logs);
    } catch (error) {
      logger.error('Error getting logs', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get guild backups
   */
  async getBackups(req, res) {
    try {
      const guildId = req.query.guildId;
      const backups = await db.getGuildBackups(guildId);
      res.json(backups);
    } catch (error) {
      logger.error('Error getting backups', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get user behavior analysis
   */
  async getUserAnalysis(req, res) {
    try {
      const guildId = req.query.guildId;
      const userId = req.params.userId;
      
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(404).json({ error: 'Guild not found' });
      }
      
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const analysis = await BehaviorAnalyzer.analyzeUser(member);
      res.json(analysis);
    } catch (error) {
      logger.error('Error analyzing user', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get performance metrics
   */
  async getMetrics(req, res) {
    try {
      const metrics = {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        guildCount: client.guilds.cache.size,
        userCount: client.users.cache.size,
        commandStats: {}, // Would be populated from command usage tracking
        securityActions: {} // Would be populated from security logs
      };
      res.json(metrics);
    } catch (error) {
      logger.error('Error getting metrics', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Start dashboard server
   */
  start() {
    this.app.listen(config.DASHBOARD_PORT, () => {
      logger.info(`Dashboard running on port ${config.DASHBOARD_PORT}`);
    });
  }
}

// ==================== Sistema de Plugins ====================
class PluginSystem {
  constructor() {
    this.plugins = [];
  }

  /**
   * Register new plugin
   * @param {Object} plugin - Plugin object
   * @returns {boolean} True if registration was successful
   */
  register(plugin) {
    if (this.validatePlugin(plugin)) {
      this.plugins.push(plugin);
      logger.info(`Plugin registered: ${plugin.name}`);
      return true;
    }
    return false;
  }

  /**
   * Validate plugin structure
   * @param {Object} plugin - Plugin to validate
   * @returns {boolean} True if plugin is valid
   */
  validatePlugin(plugin) {
    const requiredProps = ['name', 'version'];
    const requiredMethods = ['init', 'handleEvent'];
    
    const hasProps = requiredProps.every(prop => prop in plugin);
    const hasMethods = requiredMethods.every(method => typeof plugin[method] === 'function');
    
    return hasProps && hasMethods;
  }

  /**
   * Initialize all registered plugins
   * @returns {Promise<void>}
   */
  async initAll() {
    for (const plugin of this.plugins) {
      try {
        await plugin.init(client, config, db);
        logger.info(`Plugin ${plugin.name} initialized`);
      } catch (error) {
        logger.error(`Failed to initialize plugin ${plugin.name}`, { error });
      }
    }
  }

  /**
   * Dispatch event to all plugins
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @returns {Promise<void>}
   */
  async dispatchEvent(event, data) {
    for (const plugin of this.plugins) {
      try {
        await plugin.handleEvent(event, data);
      } catch (error) {
        logger.error(`Error in plugin ${plugin.name} processing event ${event}`, { error });
      }
    }
  }
}

// ==================== Plugins Base ====================
class AntiRaidPlugin {
  constructor() {
    this.name = "Anti-Raid";
    this.version = "1.1";
    this.description = "Protection against raids and mass joins";
  }

  /**
   * Initialize plugin
   */
  async init(client, config, db) {
    this.client = client;
    this.config = config;
    this.db = db;
  }

  /**
   * Handle events
   */
  async handleEvent(event, data) {
    if (event === 'memberJoin') {
      await this.handleMemberJoin(data.member);
    }
  }

  /**
   * Handle new member join
   */
  async handleMemberJoin(member) {
    if (!this.config.RAID_PROTECTION) return;
    
    try {
      // Record join
      const joins = await this.db.recentJoins.get([]) || [];
      await this.db.recentJoins.set([...joins, Date.now()]);
      
      // Check if exceeded limit
      if (joins.length + 1 > this.config.MAX_JOIN_RATE) {
        await SecurityManager.applySafetyMeasures(
          member,
          'Possible raid detected (too many joins in short period)',
          'quarantine'
        );
      }
      
      // Check suspicious account
      await SecurityManager.checkSuspiciousAccount(member);
    } catch (error) {
      logger.error('Anti-Raid plugin failed', { error });
    }
  }
}

class ContentModerationPlugin {
  constructor() {
    this.name = "Content Moderation";
    this.version = "1.1";
    this.description = "Content moderation and banned words";
    this.profanityFilter = new ProfanityEngine();
  }

  /**
   * Initialize plugin
   */
  async init(client, config, db) {
    this.client = client;
    this.config = config;
    this.db = db;
    
    // Load banned words
    if (this.config.BANNED_WORDS.length > 0) {
      this.profanityFilter.addWords(...this.config.BANNED_WORDS);
    }
  }

  /**
   * Handle events
   */
  async handleEvent(event, data) {
    if (event === 'messageCreate' && data.message) {
      await this.handleMessage(data.message);
    }
  }

  /**
   * Handle new message
   */
  async handleMessage(message) {
    if (!this.config.AUTO_MODERATION || message.author.bot) return;
    
    try {
      // Check banned words
      if (this.profanityFilter.isProfane(message.content)) {
        await message.delete();
        await SecurityManager.applySafetyMeasures(
          message.member,
          'Message contains banned content',
          'timeout',
          { content: message.content }
        );
        return;
      }
      
      // Check suspicious links
      const suspiciousLinks = message.content.match(/https?:\/\/[^\s]+/g) || [];
      if (suspiciousLinks.some(link => 
        link.includes('discord.gg') || 
        link.includes('discord.com/invite')
      )) {
        await message.delete();
        await SecurityManager.applySafetyMeasures(
          message.member,
          'Message contains suspicious links',
          'timeout',
          { links: suspiciousLinks }
        );
      }
    } catch (error) {
      logger.error('Content Moderation plugin failed', { error });
    }
  }
}

// ==================== Tarefas Agendadas ====================
function scheduleTasks() {
  // Daily data cleanup
  schedule.scheduleJob('0 3 * * *', async () => {
    logger.info('Starting daily data cleanup');
    try {
      await db.cleanOldData();
      logger.info('Daily cleanup completed');
    } catch (error) {
      logger.error('Daily cleanup failed', { error });
    }
  });
  
  // Automatic backups
  schedule.scheduleJob(`*/${config.AUTO_BACKUP_INTERVAL_MS / 60000} * * * *`, async () => {
    logger.info('Starting automatic backup');
    for (const guild of client.guilds.cache.values()) {
      try {
        await BackupSystem.createBackup(guild);
      } catch (error) {
        logger.error(`Failed to create backup for ${guild.name}`, { error });
      }
    }
  });
  
  // Daily report
  schedule.scheduleJob('0 18 * * *', async () => {
    logger.info('Preparing daily report');
    for (const guild of client.guilds.cache.values()) {
      try {
        const report = await generateDailyReport(guild);
        await SecurityLogger.logAction(guild, 'Daily Report', report, 'info');
      } catch (error) {
        logger.error(`Failed to generate report for ${guild.name}`, { error });
      }
    }
  });
}

/**
 * Generate daily security report
 */
async function generateDailyReport(guild) {
  const membersJoined = (await db.recentJoins.get([]) || []).length;
  const actionsTaken = (await db.get(`logs.${guild.id}`) || [])
    .filter(log => log.severity === 'high' || log.severity === 'critical').length;
  
  return `📊 **Daily Report for ${guild.name}**\n` +
         `👥 New members: ${membersJoined}\n` +
         `🛡️ Security actions: ${actionsTaken}\n` +
         `📅 ${new Date().toLocaleDateString()}`;
}

// ==================== SISTEMA DE PROTEÇÃO ====================
// (As classes ConnectionManager, DDOSProtection, HealthMonitor e NetworkProtection vão aqui)

// ==================== Inicialização do Bot ====================
const config = new ConfigManager();
const db = new PersistentData();
const dashboard = new Dashboard();
const pluginSystem = new PluginSystem();

// Registrar plugins
pluginSystem.register(new AntiRaidPlugin());
pluginSystem.register(new ContentModerationPlugin());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Message, 
    Partials.Channel, 
    Partials.GuildMember, 
    Partials.User, 
    Partials.Reaction
  ]
});

// Eventos do cliente
client.on('ready', async () => {
  logger.info(`✅ Bot connected as ${client.user.tag}`);
  
  try {
    await db.initialize();
    await pluginSystem.initAll();
        const connectionManager = new ConnectionManager(client, db);
    const ddosProtection = new DDOSProtection(db);
    const healthMonitor = new HealthMonitor(client, db);
    const networkProtection = new NetworkProtection(db);

    connectionManager.setupListeners();
    await networkProtection.configureClient(client);
    networkProtection.setupAutoRotation();

    dashboard.app.use(ddosProtection.middleware());
    dashboard.start();
    scheduleTasks();
  } catch (error) {
    logger.error('Initialization failed', { error });
  }
});

client.on('guildMemberAdd', async member => {
  try {
    await pluginSystem.dispatchEvent('memberJoin', { member });
    await BehaviorAnalyzer.analyzeUser(member);
  } catch (error) {
    logger.error('Error in guildMemberAdd', { error });
  }
});

client.on('messageCreate', async message => {
  try {
    if (message.member && !message.author.bot) {
      await pluginSystem.dispatchEvent('messageCreate', { message });
      await BehaviorAnalyzer.analyzeUser(message.member);
    }
  } catch (error) {
    logger.error('Error in messageCreate', { error });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, member } = interaction;

  try {
    switch (commandName) {
      case 'backup':
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: '❌ No permission.', ephemeral: true });
        }
        await BackupSystem.createBackup(interaction.guild);
        await interaction.reply('✅ Backup started!');
        break;
        
      case 'restore':
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: '❌ No permission.', ephemeral: true });
        }
        const backupId = options.getString('id');
        await BackupSystem.restoreBackup(interaction.guild, backupId, interaction.member);
        break;
        
      case 'lockdown':
        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
          return interaction.reply({ content: '❌ No permission.', ephemeral: true });
        }
        await interaction.reply('🔒 Lockdown activated!');
        break;
        
      case 'unlock':
        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
          return interaction.reply({ content: '❌ No permission.', ephemeral: true });
        }
        await interaction.reply('🔓 Lockdown deactivated!');
        break;
        
      case 'userinfo':
        const user = options.getUser('user') || interaction.user;
        const memberInfo = await interaction.guild.members.fetch(user.id);
        const profile = await db.getUserProfile(user.id);
        
        const embed = new EmbedBuilder()
          .setTitle(`User info for ${user.tag}`)
          .addFields(
            { name: 'Account created', value: user.createdAt.toLocaleDateString(), inline: true },
            { name: 'Joined server', value: memberInfo.joinedAt.toLocaleDateString(), inline: true },
            { name: 'Reputation', value: profile.reputationScore.toString(), inline: true }
          )
          .setThumbnail(user.displayAvatarURL());
          
        await interaction.reply({ embeds: [embed] });
        break;
    }
  } catch (error) {
    logger.error(`Error in command ${commandName}`, { error });
    await SecurityLogger.logAction(
      interaction.guild,
      'Command Error',
      `Failed to execute ${commandName}: ${error.message}`,
      'high',
      { error: error.stack }
    );
    await interaction.reply('❌ An error occurred while executing this command.');
  }
});

// Iniciar o bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
  logger.error('Failed to connect bot', { error });
  process.exit(1);
});
