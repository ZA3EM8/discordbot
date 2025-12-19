require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, SlashCommandBuilder, REST, Routes, ActivityType } = require('discord.js');
const fs = require('fs');

// Dev By ThailandCodes - HOOK

const DEVELOPER_IDS = ['1148713017350033582'];   // ايدي المبرمج

const DANGEROUS_PERMISSIONS = [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.MentionEveryone
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildBans, 
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Dev By ThailandCodes - HOOK

const dataFile = './security_data.json';
let securityData = { guilds: {} };

function isDeveloper(userId) { return DEVELOPER_IDS.includes(userId); }

function loadData() { 
    try { 
        if (fs.existsSync(dataFile)) { 
            const rawData = fs.readFileSync(dataFile, 'utf8');
            securityData = JSON.parse(rawData);
            console.log('✅ تم تحميل البيانات المحفوظة بنجاح');
        } else {
            console.log('📝 لم يتم العثور على ملف البيانات - سيتم إنشاء ملف جديد');
        }
    } catch (e) { 
        console.error('❌ خطأ في تحميل البيانات:', e);
        securityData = { guilds: {} };
    } 
}

function saveData() { 
    try { 
        fs.writeFileSync(dataFile, JSON.stringify(securityData, null, 2));
        console.log('💾 تم حفظ البيانات بنجاح');
    } catch (e) { 
        console.error('❌ خطأ في حفظ البيانات:', e); 
    } 
}

function initGuildData(guildId) {
    if (!securityData.guilds[guildId]) {
        securityData.guilds[guildId] = {};
    }
    
    const guildData = securityData.guilds[guildId];

    if (!guildData.protection) {
        guildData.protection = { enabled: false, antiBot: false, antiSpam: false, antiRaid: false, antiRoleGrant: false, roleProtection: false, channelProtection: false };
    }
    if (!guildData.advancedWhitelist) {
        guildData.advancedWhitelist = { users: {}, roles: {} };
    }
    if (!guildData.backups) {
        guildData.backups = { roles: [], channels: [] };
    }
    if (!guildData.limits) {
        guildData.limits = {
            channelDelete: { limit: 3, action: 'none' },
            roleDelete: { limit: 3, action: 'none' }
        };
    }
    if (!guildData.violations) {
        guildData.violations = {};
    }
    
    saveData();
}

function hasPermission(member, guildId, permission) {
    if (!member) return false;
    if (isDeveloper(member.id) || member.id === member.guild.ownerId) return true;
    const guildWl = securityData.guilds[guildId]?.advancedWhitelist;
    if (!guildWl) return false;
    const userPerms = guildWl.users[member.id] || [];
    if (userPerms.includes('BYPASS_ALL') || userPerms.includes(permission)) return true;
    for (const roleId of member.roles.cache.keys()) {
        const rolePerms = guildWl.roles[roleId] || [];
        if (rolePerms.includes('BYPASS_ALL') || rolePerms.includes(permission)) return true;
    }
    return false;
}

const spamMap = new Map();
async function notifyOwner(guild, embed) { try { const owner = await guild.fetchOwner(); await owner.send({ embeds: [embed] }); } catch (e) { console.error('Failed to notify owner:', e); } }

async function createBackups(guild) {
    const guildData = securityData.guilds[guild.id];
    guildData.backups.roles = guild.roles.cache.map(role => ({
        id: role.id, name: role.name, color: role.color,
        permissions: role.permissions.bitfield.toString(),
        position: role.position, hoist: role.hoist, mentionable: role.mentionable
    }));
    guildData.backups.channels = guild.channels.cache.map(channel => ({
        id: channel.id, name: channel.name, type: channel.type, position: channel.position, parentId: channel.parentId,
        permissions: channel.permissionOverwrites?.cache 
            ? channel.permissionOverwrites.cache.map(p => ({
                id: p.id, type: p.type, allow: p.allow.bitfield.toString(), deny: p.deny.bitfield.toString()
            })) 
            : []
    }));
    saveData();
}

async function restoreRoles(guild, guildData) {
    const backupRoles = guildData.backups.roles;
    if (!backupRoles || backupRoles.length === 0) throw new Error(' لا توجد نسخة احتياطية للرولات.');
    let restoredCount = 0;
    for (const roleData of [...backupRoles].reverse()) {
        if (!guild.roles.cache.has(roleData.id)) {
            try {
                await guild.roles.create({
                    name: roleData.name, color: roleData.color,
                    permissions: BigInt(roleData.permissions), position: roleData.position,
                    hoist: roleData.hoist, mentionable: roleData.mentionable,
                    reason: 'استعادة من النسخة الاحتياطية'
                });
                restoredCount++;
            } catch (e) { console.error(`Failed to restore role ${roleData.name}:`, e.message); }
        }
    }
    return restoredCount;
}

async function restoreChannels(guild, guildData) {
    const backupChannels = guildData.backups.channels;
    if (!backupChannels || backupChannels.length === 0) throw new Error(' لا توجد نسخة احتياطية للاتشانلات.');
    let restoredCount = 0;
    const categories = backupChannels.filter(c => c.type === 4);
    const others = backupChannels.filter(c => c.type !== 4);
    for (const channelData of [...categories, ...others]) {
        if (!guild.channels.cache.has(channelData.id)) {
            try {
                const perms = channelData.permissions.map(p => ({ id: p.id, allow: BigInt(p.allow), deny: BigInt(p.deny) }));
                const created = await guild.channels.create({
                    name: channelData.name, type: channelData.type,
                    position: channelData.position, parent: channelData.parentId,
                    permissionOverwrites: perms, reason: 'استعادة من النسخة الاحتياطية'
                });
                if (typeof channelData.position === 'number') {
                    await created.setPosition(channelData.position).catch(() => null);
                }
                restoredCount++;
            } catch (e) { console.error(`Failed to restore channel ${channelData.name}:`, e.message); }
        }
    }
    return restoredCount;
}

async function restoreDeletedChannel(guild, deletedChannelId) {
    try {
        const guildData = securityData.guilds[guild.id];
        const backups = guildData?.backups?.channels || [];
        const backup = backups.find(c => c.id === deletedChannelId);

        if (!backup) {
            return { restored: false, reason: 'no_backup' };
        }

        let parentId = backup.parentId || null;
        let parentRestored = false;

        if (parentId && !guild.channels.cache.has(parentId)) {
            const parentBackup = backups.find(c => c.id === parentId && c.type === 4);
            if (parentBackup) {
                try {
                    const parentPerms = (parentBackup.permissions || []).map(p => ({
                        id: p.id,
                        allow: BigInt(p.allow),
                        deny: BigInt(p.deny)
                    }));
                    const newParent = await guild.channels.create({
                        name: parentBackup.name,
                        type: parentBackup.type, 
                        permissionOverwrites: parentPerms,
                        reason: 'استعادة تلقائية للفئة بعد حذف غير مصرح به'
                    });
                    parentId = newParent.id;
                    parentRestored = true;
                } catch (e) {
                    console.error('Failed to restore parent category:', e);
                    parentId = null;
                }
            } else {
                parentId = null;
            }
        }

        const perms = (backup.permissions || []).map(p => ({
            id: p.id,
            allow: BigInt(p.allow),
            deny: BigInt(p.deny)
        }));

        const newChannel = await guild.channels.create({
            name: backup.name,
            type: backup.type,
            parent: parentId ?? undefined,
            permissionOverwrites: perms,
            reason: 'استعادة تلقائية بعد حذف غير مصرح به'
        });

        if (typeof backup.position === 'number') {
            await newChannel.setPosition(backup.position).catch(() => null);
        }

        return { restored: true, channel: newChannel, parentRestored };
    } catch (e) {
        console.error('Failed to restore deleted channel:', e);
        return { restored: false, reason: 'create_failed', error: e };
    }
}

const protectionChoices = [
    { name: 'Bypass All Protections', value: 'BYPASS_ALL' }, { name: 'Bypass Anti-Bot', value: 'BYPASS_ANTI_BOT' }, { name: 'Bypass Anti-Spam', value: 'BYPASS_ANTI_SPAM' },
    { name: 'Bypass Anti-Role Grant', value: 'BYPASS_ANTI_ROLE_GRANT' }, { name: 'Bypass Role Protection', value: 'BYPASS_ROLE_PROTECTION' }, { name: 'Bypass Channel Protection', value: 'BYPASS_CHANNEL_PROTECTION' }
];

const commands = [
    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('إدارة صلاحيات الوايت ليست المتقدمة')
        .setDefaultMemberPermissions(0)
        .addSubcommandGroup(group => 
            group.setName('grant').setDescription('منح صلاحية')
            .addSubcommand(sub => 
                sub.setName('user').setDescription('منح صلاحية لمستخدم')
                .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true))
                .addStringOption(o => o.setName('permission').setDescription('الصلاحية').setRequired(true).addChoices(...protectionChoices))
            )
            .addSubcommand(sub => 
                sub.setName('role').setDescription('منح صلاحية لرتبة')
                .addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true))
                .addStringOption(o => o.setName('permission').setDescription('الصلاحية').setRequired(true).addChoices(...protectionChoices))
            )
        )
        .addSubcommandGroup(group => 
            group.setName('revoke').setDescription('سحب صلاحية')
            .addSubcommand(sub => 
                sub.setName('user').setDescription('سحب صلاحية من مستخدم')
                .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true))
                .addStringOption(o => o.setName('permission').setDescription('الصلاحية').setRequired(true).addChoices(...protectionChoices))
            )
            .addSubcommand(sub => 
                sub.setName('role').setDescription('سحب صلاحية من رتبة')
                .addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true))
                .addStringOption(o => o.setName('permission').setDescription('الصلاحية').setRequired(true).addChoices(...protectionChoices))
            )
        )
        .addSubcommand(sub => sub.setName('view').setDescription('عرض صلاحيات الوايت ليست الحالية')),
    new SlashCommandBuilder()
        .setName('protection')
        .setDescription('إعدادات الحماية')
        .setDefaultMemberPermissions(0)
        .addSubcommand(s => 
            s.setName('toggle').setDescription('تشغيل/إيقاف حماية')
            .addStringOption(o => o.setName('type').setDescription('نوع الحماية').setRequired(true).addChoices(
                { name: 'Anti-Bot', value: 'antiBot' }, 
                { name: 'Anti-Spam', value: 'antiSpam' }, 
                { name: 'Anti-Raid', value: 'antiRaid' }, 
                { name: 'Anti-Role Grant', value: 'antiRoleGrant' }, 
                { name: 'Role Protection', value: 'roleProtection' }, 
                { name: 'Channel Protection', value: 'channelProtection' }
            ))
        )
        .addSubcommand(s => s.setName('status').setDescription('عرض حالة الحماية')),
    new SlashCommandBuilder()
        .setName('backup')
        .setDescription('إدارة النسخ الاحتياطي')
        .setDefaultMemberPermissions(0)
        .addSubcommand(s => s.setName('create').setDescription('إنشاء نسخة احتياطية'))
        .addSubcommand(s => s.setName('restore').setDescription('استعادة النسخة الكاملة'))
        .addSubcommand(s => s.setName('restore-roles').setDescription(' استعادة الرولات '))
        .addSubcommand(s => s.setName('restore-channels').setDescription(' استعادة الاتشانلات'))
        .addSubcommand(s => s.setName('info').setDescription('معلومات النسخة الاحتياطية')),
    new SlashCommandBuilder()
        .setName('limit-settings')
        .setDescription('إدارة حدود العقوبات على حذف الرتب والقنوات')
        .setDefaultMemberPermissions(0)
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('تعيين حد وعقوبة لنوع معين من الإجراءات')
            .addStringOption(option => option.setName('type').setDescription('نوع الإجراء الذي تريد ضبطه').setRequired(true).addChoices(
                { name: ' حذف الاتشانلات', value: 'channelDelete' }, 
                { name: 'حذف الرتب', value: 'roleDelete' }
            ))
            .addIntegerOption(option => option.setName('limit').setDescription('العدد المسموح به خلال ساعة قبل تطبيق العقوبة').setRequired(true).setMinValue(1))
            .addStringOption(option => option.setName('action').setDescription('الإجراء الذي سيتم اتخاذه بعد تجاوز الحد').setRequired(true).addChoices(
                { name: 'لا شيء (إشعار فقط)', value: 'none' }, 
                { name: 'طرد (Kick)', value: 'kick' }, 
                { name: 'حظر (Ban)', value: 'ban' }
            )))
        .addSubcommand(sub => sub.setName('view').setDescription('عرض الإعدادات الحالية لحدود العقوبات'))
];

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        console.log('بدء تسجيل الأوامر...');
        
        for (const guild of client.guilds.cache.values()) {
            const permissions = [];
            for (const developerId of DEVELOPER_IDS) {
                permissions.push({
                    id: developerId,
                    type: 2, 
                    permission: true
                });
            }
            
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
                { body: commands.map(cmd => cmd.toJSON()) }
            );
            
            try {
                const guildCommands = await rest.get(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id)
                );
                
                for (const command of guildCommands) {
                    await rest.put(
                        Routes.applicationCommandPermissions(process.env.CLIENT_ID, guild.id, command.id),
                        { permissions: permissions }
                    );
                }
            } catch (permError) {
                console.log(`تم تخطي تحديث الصلاحيات للخادم ${guild.name} - قد لا تكون مدعومة`);
            }
        }
        
        console.log('تم تسجيل الأوامر بنجاح للمطورين فقط!');
    } catch (error) { 
        console.error('خطأ في تسجيل الأوامر:', error); 
    }
}

console.log(
    '\n' +
    '┌────────────────────────────────────────────┐\n' +
    '│               ThailandCodes               │\n' +
    '│                    HOOK                    │\n' +
    '└────────────────────────────────────────────┘\n'
);
    
    loadData(); 
    registerCommands();
    client.guilds.cache.forEach(guild => initGuildData(guild.id));
    
    loadData(); 
    registerCommands();
    client.guilds.cache.forEach(guild => initGuildData(guild.id));

client.on('guildCreate', guild => {
    initGuildData(guild.id);
    registerCommands();
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    initGuildData(message.guild.id);
    const guildData = securityData.guilds[message.guild.id];

    if (message.mentions.has(client.user.id) && isDeveloper(message.author.id)) {
        const content = message.content.replace(/<@!?\d+>/, '').trim();
        const args = content.split(/ +/);
        const command = args.shift()?.toLowerCase();

    }

    if (message.content === '+onpro' || message.content === '+offpro') {
        if (!isDeveloper(message.author.id)) return message.reply('❌ المبرمج فقط من يستطيع إستخدام هذا الأمر ');
        const enable = message.content === '+onpro';
        Object.keys(guildData.protection).forEach(key => guildData.protection[key] = enable);
        if (enable) await createBackups(message.guild);
        saveData();
        const embed = new EmbedBuilder().setTitle(enable ? '🛡️ Protection Activated ' : '🔴 Protection Disabled').setDescription(`بواسطة المطور ${message.author.tag}.`).setColor(enable ? 0x00ff00 : 0xff0000);
        message.reply({ embeds: [embed] });
    }

    if (guildData.protection.enabled && guildData.protection.antiSpam && !hasPermission(message.member, message.guild.id, 'BYPASS_ANTI_SPAM')) {
        const userId = message.author.id;
        const now = Date.now();
        const userSpam = spamMap.get(userId) || [];
        const relevantSpam = userSpam.filter(t => now - t < 5000);
        relevantSpam.push(now);
        spamMap.set(userId, relevantSpam);
        if (relevantSpam.length > 5) {
            try {
                await message.member.timeout(300000, 'السبام المفرط');
                const embed = new EmbedBuilder().setTitle('🚨 تم اكتشاف سبام').setDescription(`**المستخدم:** ${message.author}`).setColor(0xff9900);
                await notifyOwner(message.guild, embed);
                spamMap.delete(userId);
            } catch (e) { console.error('Anti-Spam Error:', e); }
        }
    }
});

client.on('guildMemberAdd', async (member) => {
    const guildData = securityData.guilds[member.guild.id];
    if (!guildData?.protection.enabled || !guildData.protection.antiBot || !member.user.bot) return;
    const auditLogs = await member.guild.fetchAuditLogs({ type: 28, limit: 1 });
    const log = auditLogs.entries.first();
    if (!log || log.target.id !== member.user.id) return;
    const inviter = await member.guild.members.fetch(log.executor.id).catch(() => null);
    if (inviter && !hasPermission(inviter, member.guild.id, 'BYPASS_ANTI_BOT')) {
        try {
            await member.ban({ reason: 'بوت غير مصرح به' });
            const roles = inviter.roles.cache.filter(r => !r.managed && r.name !== '@everyone');
            await inviter.roles.remove(roles, 'إضافة بوت بدون تصريح');
            const embed = new EmbedBuilder().setTitle('🤖 تم حظر بوت غير مصرح').setDescription(`**البوت:** ${member.user.tag}\n**المدعو:** ${log.executor.tag}`).setColor(0xff0000);
            await notifyOwner(member.guild, embed);
        } catch (e) { console.error('Anti-Bot Error:', e); }
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const guildData = securityData.guilds[newMember.guild.id];
    if (!guildData?.protection.enabled || !guildData.protection.antiRoleGrant) return;
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    if (addedRoles.size === 0) return;
    const dangerousRolesAdded = addedRoles.filter(role => DANGEROUS_PERMISSIONS.some(perm => role.permissions.has(perm)));
    if (dangerousRolesAdded.size === 0) return;
    const auditLogs = await newMember.guild.fetchAuditLogs({ type: 25, limit: 5 });
    const log = auditLogs.entries.find(entry => entry.target.id === newMember.id && entry.changes.some(change => change.key === '$add' && change.new.some(role => dangerousRolesAdded.has(role.id))) && Date.now() - entry.createdTimestamp < 10000);
    if (!log) return;
    const grantor = await newMember.guild.members.fetch(log.executor.id).catch(() => null);
    if (!grantor || hasPermission(grantor, newMember.guild.id, 'BYPASS_ANTI_ROLE_GRANT')) return;
    try {
        await newMember.roles.remove(dangerousRolesAdded, 'منح صلاحيات خطيرة غير مصرح به');
        const grantorRoles = grantor.roles.cache.filter(r => !r.managed && r.name !== '@everyone');
        if (grantorRoles.size > 0) await grantor.roles.remove(grantorRoles, 'محاولة تخريبية بمنح رول ');
        const embed = new EmbedBuilder().setTitle('🚨 تم اكتشاف منح صلاحيات خطيرة!').setDescription(`**المانح:** ${grantor.user.tag} (تمت معاقبته)\n**المستلم:** ${newMember.user.tag}`).setColor(0xff0000).addFields({ name: 'الرول المسحوبة', value: dangerousRolesAdded.map(r => r.name).join(', ') }).setTimestamp();
        await notifyOwner(newMember.guild, embed);
    } catch (e) {
        console.error('Anti-Role Grant Error:', e);
        await notifyOwner(newMember.guild, new EmbedBuilder().setTitle('❌ خطأ في نظام الحماية').setDescription(`فشل نظام الحماية من منح الرتب في معاقبة ${grantor?.user?.tag || 'مستخدم غير معروف'}. قد تكون رتبة البوت أقل من الرتب الأخرى.`));
    }
});

client.on('channelDelete', async (channel) => {
    const guild = channel.guild;
    const guildData = securityData.guilds[guild.id];
    if (!guildData?.protection.enabled || !guildData.protection.channelProtection) return;

    try {
        const auditLogs = await guild.fetchAuditLogs({ type: 12, limit: 1 });
        const log = auditLogs.entries.first();
        if (!log || log.target.id !== channel.id || Date.now() - log.createdTimestamp > 5000) return;

        const deleter = await guild.members.fetch(log.executor.id).catch(() => null);
        if (!deleter || hasPermission(deleter, guild.id, 'BYPASS_CHANNEL_PROTECTION')) return;

        const restoreResult = await restoreDeletedChannel(guild, channel.id);

        const userId = deleter.id;
        const settings = guildData.limits.channelDelete;
        if (!guildData.violations[userId]) guildData.violations[userId] = { channelDelete: [], roleDelete: [] };
        const userViolations = guildData.violations[userId].channelDelete;
        const now = Date.now();
        userViolations.push(now);
        const recentViolations = userViolations.filter(timestamp => now - timestamp < 3600000);
        guildData.violations[userId].channelDelete = recentViolations;
        saveData();

        const violationCount = recentViolations.length;
        const limit = settings.limit;

        const statusText = restoreResult.restored
            ? `✅ تم الاستعادة تلقائياً${restoreResult.channel ? ` → ${restoreResult.channel}` : ''}${restoreResult.parentRestored ? ' (تم استعادة الفئة أولاً)' : ''}`
            : (restoreResult.reason === 'no_backup'
                ? '❌ فشل الاستعادة - لا توجد نسخة احتياطية لهذه القناة'
                : '❌ فشل الاستعادة - حدث خطأ أثناء الإنشاء');

        const initialEmbed = new EmbedBuilder()
            .setTitle('🚨 تم حذف اتشانل/فويس')
            .setDescription(`**المحذوف:** \`#${channel.name}\`\n**بواسطة:** ${deleter.user.tag}`)
            .setColor(restoreResult.restored ? 0x00ff00 : 0xffa500)
            .addFields(
                { name: 'حالة الاستعادة', value: statusText },
                { name: 'الانتهاكات المسجلة', value: `${violationCount} / ${limit} خلال الساعة الأخيرة` }
            )
            .setTimestamp();

        await notifyOwner(guild, initialEmbed);

        if (restoreResult.restored) {
            await createBackups(guild);
        }

        if (violationCount >= limit && settings.action !== 'none') {
            try {
                if (settings.action === 'kick') await deleter.kick(`تجاوز حد الحذف  (${limit} قناة).`);
                else if (settings.action === 'ban') await deleter.ban({ reason: `تجاوز حد حذف من الاتشانلات والفويسات (${limit} قناة).` });
                const punishmentEmbed = new EmbedBuilder().setTitle(`✅ تم تطبيق العقوبة: ${settings.action.toUpperCase()}`).setDescription(`**المستخدم:** ${deleter.user.tag}\n**السبب:** تجاوز الحد المسموح به لحذف الاتشانلز / الفويسات.`).setColor(0xff0000).setTimestamp();
                await notifyOwner(guild, punishmentEmbed);
                guildData.violations[userId].channelDelete = [];
                saveData();
            } catch (e) {
                console.error(`Failed to apply punishment for channel deletion:`, e);
                await notifyOwner(guild, new EmbedBuilder().setTitle('❌ فشل تطبيق العقوبة').setDescription(`لم أتمكن من معاقبة ${deleter.user.tag}. يرجى التحقق من صلاحياتي.`));
            }
        }
    } catch (error) {
        console.error('خطأ في معالج حذف القنوات:', error);
    }
});

client.on('roleDelete', async (role) => {
    const guild = role.guild;
    const guildData = securityData.guilds[guild.id];
    if (!guildData?.protection.enabled || !guildData.protection.roleProtection) return;
    
    try {
        const auditLogs = await guild.fetchAuditLogs({ type: 32, limit: 1 });
        const log = auditLogs.entries.first();
        if (!log || log.target.id !== role.id || Date.now() - log.createdTimestamp > 5000) return;
        
        const deleter = await guild.members.fetch(log.executor.id).catch(() => null);
        if (!deleter || hasPermission(deleter, guild.id, 'BYPASS_ROLE_PROTECTION')) return;

        console.log(`الرول ${role.name} تم حذفها بواسطة ${deleter.user.tag} - سيتم الاستعادة`);

        const backupRole = guildData.backups.roles.find(r => r.id === role.id);
        let restoreSuccess = false;
        let restoredRole = null;

        if (backupRole) {
            try {
                restoredRole = await guild.roles.create({ 
                    name: backupRole.name, 
                    color: backupRole.color, 
                    permissions: BigInt(backupRole.permissions), 
                    position: backupRole.position, 
                    hoist: backupRole.hoist, 
                    mentionable: backupRole.mentionable, 
                    reason: 'استعادة تلقائية بعد حذف غير مصرح به' 
                });
                
                restoreSuccess = true;
                console.log(`✅ تم استعادة الرول ${backupRole.name} بنجاح`);

                await createBackups(guild);
            } catch (e) {
                console.error(`❌ فشل في استعادة الرول ${backupRole.name}:`, e.message);
            }
        } else {
            console.log(`❌ لم يتم العثور على نسخة احتياطية للرول ${role.name}`);
        }

        const userId = deleter.id;
        const settings = guildData.limits.roleDelete;
        if (!guildData.violations[userId]) guildData.violations[userId] = { channelDelete: [], roleDelete: [] };
        const userViolations = guildData.violations[userId].roleDelete;
        const now = Date.now();
        userViolations.push(now);
        const recentViolations = userViolations.filter(timestamp => now - timestamp < 3600000);
        guildData.violations[userId].roleDelete = recentViolations;
        saveData();
        
        const violationCount = recentViolations.length;
        const limit = settings.limit;
        
        const statusText = restoreSuccess ? '✅ تم الاستعادة تلقائياً' : '❌ فشل في الاستعادة';
        const embedColor = restoreSuccess ? 0x00ff00 : 0xff0000;
        
        const initialEmbed = new EmbedBuilder()
            .setTitle('🚨 تم حذف رول')
            .setDescription(`**الرول المحذوفة:** \`@${role.name}\`\n**بواسطة:** ${deleter.user.tag}\n**حالة الاستعادة:** ${statusText}${restoredRole ? `\n**الرول الجديدة:** ${restoredRole}` : ''}`)
            .setColor(embedColor)
            .addFields({ name: 'الانتهاكات المسجلة', value: `${violationCount} / ${limit} خلال الساعة الأخيرة` })
            .setTimestamp();
            
        await notifyOwner(guild, initialEmbed);

        if (violationCount >= limit && settings.action !== 'none') {
            try {
                if (settings.action === 'kick') await deleter.kick(`تجاوز حد حذف الرولات (${limit} رتبة).`);
                else if (settings.action === 'ban') await deleter.ban({ reason: `تجاوز حد حذف الرولات (${limit} رتبة).` });
                
                const punishmentEmbed = new EmbedBuilder()
                    .setTitle(`⚖️ تم تطبيق العقوبة: ${settings.action.toUpperCase()}`)
                    .setDescription(`**المستخدم:** ${deleter.user.tag}\n**السبب:** تجاوز الحد المسموح به لحذف الرتب`)
                    .setColor(0xff0000)
                    .setTimestamp();
                    
                await notifyOwner(guild, punishmentEmbed);
                guildData.violations[userId].roleDelete = [];
                saveData();
            } catch (e) {
                console.error(`Failed to apply punishment for role deletion:`, e);
                await notifyOwner(guild, new EmbedBuilder()
                    .setTitle('❌ فشل تطبيق العقوبة')
                    .setDescription(`لم أتمكن من معاقبة ${deleter.user.tag}. يرجى التحقق من صلاحياتي.`)
                    .setColor(0xff0000));
            }
        }
    } catch (error) {
        console.error('خطأ في معالج حذف الرولات:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;
    initGuildData(interaction.guild.id);
    
    const isDev = isDeveloper(interaction.user.id);

    if (!isDev) {
        return interaction.reply({ content: '❌ هذه الأوامر للمطورين فقط.', ephemeral: true });
    }

    if (commandName === 'whitelist') {
        const guildData = securityData.guilds[interaction.guild.id];
        const group = options.getSubcommandGroup();
        const subcommand = options.getSubcommand();
        const targetUser = options.getUser('user');
        const targetRole = options.getRole('role');
        const permission = options.getString('permission');
        if (subcommand === 'view') {
            const wl = guildData.advancedWhitelist;
            const embed = new EmbedBuilder().setTitle(' Whitelist Members').setColor(0x0099ff);
            let userPerms = Object.entries(wl.users).map(([id, perms]) => `<@${id}>: \`${perms.join(', ')}\``).join('\n') || 'لا يوجد';
            embed.addFields({ name: '👥 صلاحيات المستخدمين', value: userPerms });
            let rolePerms = Object.entries(wl.roles).map(([id, perms]) => `<@&${id}>: \`${perms.join(', ')}\``).join('\n') || 'لا يوجد';
            embed.addFields({ name: '🏷️ صلاحيات الرولات', value: rolePerms });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        const targetId = targetUser ? targetUser.id : targetRole.id;
        const targetType = targetUser ? 'users' : 'roles';
        const wl = guildData.advancedWhitelist;
        if (group === 'grant') {
            if (!wl[targetType][targetId]) wl[targetType][targetId] = [];
            if (wl[targetType][targetId].includes(permission)) return interaction.reply({ content: '❌ هذه الصلاحية ممنوحة بالفعل.', ephemeral: true });
            wl[targetType][targetId].push(permission);
            saveData();
            interaction.reply({ content: `✅ تم منح صلاحية \`${permission}\` بنجاح.`, ephemeral: true });
        } else if (group === 'revoke') {
            if (!wl[targetType][targetId] || !wl[targetType][targetId].includes(permission)) return interaction.reply({ content: '❌ هذه الصلاحية غير ممنوحة أصلاً.', ephemeral: true });
            wl[targetType][targetId] = wl[targetType][targetId].filter(p => p !== permission);
            if (wl[targetType][targetId].length === 0) delete wl[targetType][targetId];
            saveData();
            interaction.reply({ content: `🗑️ تم سحب صلاحية \`${permission}\` بنجاح.`, ephemeral: true });
        }
    }

    if (commandName === 'protection') {
        const guildData = securityData.guilds[interaction.guild.id];
        const subcommand = options.getSubcommand();
        if (subcommand === 'toggle') {
            const type = options.getString('type');
            guildData.protection[type] = !guildData.protection[type];
            saveData();
            interaction.reply({ content: `${guildData.protection[type] ? '✅' : '❌'} تم ${guildData.protection[type] ? 'تفعيل' : 'إلغاء'} حماية ${type}.`, ephemeral: true });
        } else if (subcommand === 'status') {
            const embed = new EmbedBuilder().setTitle('🛡️ حالة الحماية').addFields(
                Object.entries(guildData.protection).map(([key, value]) => ({ name: key, value: value ? '✅ مفعل' : '❌ معطل', inline: true }))
            ).setColor(guildData.protection.enabled ? 0x00ff00 : 0xff0000);
            interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    if (commandName === 'limit-settings') {
        const subcommand = options.getSubcommand();
        const guildData = securityData.guilds[interaction.guild.id];
        if (subcommand === 'view') {
            const channelSettings = guildData.limits.channelDelete;
            const roleSettings = guildData.limits.roleDelete;
            const embed = new EmbedBuilder().setTitle('⚙️ الإعدادات الحالية لحدود العقوبات').addFields(
                { name: 'حذف الاتشانلات و الفويس', value: `الحد: **${channelSettings.limit}** | العقوبة: **${channelSettings.action}**` }, 
                { name: 'حذف الرتب', value: `الحد: **${roleSettings.limit}** | العقوبة: **${roleSettings.action}**` }
            ).setColor(0x0099ff).setFooter({ text: 'يتم احتساب الحدود خلال الساعة الأخيرة.' });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (subcommand === 'set') {
            const type = options.getString('type');
            const limit = options.getInteger('limit');
            const action = options.getString('action');
            guildData.limits[type] = { limit, action };
            saveData();
            await interaction.reply({ content: `✅ تم تحديث إعدادات **${type}** بنجاح.\nالحد الجديد: **${limit}** | العقوبة الجديدة: **${action}**`, ephemeral: true });
        }
    }

    if (commandName === 'backup') {
        await interaction.deferReply({ ephemeral: true });
        const subcommand = options.getSubcommand();
        const guildData = securityData.guilds[interaction.guild.id];

        try {
            if (subcommand === 'create') {
                await createBackups(interaction.guild);
                await interaction.editReply('✅ تم إنشاء نسخة احتياطية جديدة بنجاح.');

            } else if (subcommand === 'restore-roles') {
                const count = await restoreRoles(interaction.guild, guildData);
                await interaction.editReply(`✅ تمت محاولة استعادة الرتب. تم إنشاء ${count} رتبة جديدة.`);

            } else if (subcommand === 'restore-channels') {
                const count = await restoreChannels(interaction.guild, guildData);
                await interaction.editReply(`✅ تمت محاولة استعادة القنوات. تم إنشاء ${count} قناة جديدة.`);

            } else if (subcommand === 'restore') {
                await interaction.editReply('⏳ جارٍ استعادة الرتب...');
                const rolesCount = await restoreRoles(interaction.guild, guildData);
                await interaction.editReply(`⏳ تم استعادة ${rolesCount} رتبة. جارٍ استعادة القنوات...`);
                const channelsCount = await restoreChannels(interaction.guild, guildData);
                await interaction.editReply(`✅ تمت محاولة الاستعادة الكاملة.\n- الرتب الجديدة: ${rolesCount}\n- القنوات الجديدة: ${channelsCount}`);
                
            } else if (subcommand === 'info') {
                const embed = new EmbedBuilder()
                    .setTitle('ℹ️ معلومات النسخة الاحتياطية')
                    .setDescription(`تحتوي النسخة الاحتياطية الحالية على:\n- **${guildData.backups.roles.length}** رتبة\n- **${guildData.backups.channels.length}** قناة`)
                    .setColor(0x0099ff)
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error(`Backup/Restore error:`, error);
            await interaction.editReply(`❌ حدث خطأ أثناء تنفيذ الأمر: ${error.message}`);
        }
    }
});
    
client.login(process.env.BOT_TOKEN);