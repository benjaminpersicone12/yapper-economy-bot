

import { Bot, Embed } from './yapper.js';
import { readFile, writeFile } from 'node:fs/promises';

const bot = new Bot(process.env.YAPPER_BOT_TOKEN);
const DB_FILE = './economy.json';
const DAY = 86400000;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const HOUR = 3600000;
const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

const YELLOW = '#FFD000';

const SHOP_ITEMS = {
  apple: { name: 'Apple', price: 20, description: 'A crunchy snack.' },
  potion: { name: 'Lucky Potion', price: 150, description: 'A collectible potion.' },
  gem: { name: 'Shiny Gem', price: 250, description: 'A shiny collectible.' },
  egg: { name: 'Basic Egg', price: 100, description: 'Hatch a random pet.' },
  goldenegg: { name: 'Golden Egg', price: 500, description: 'Hatch a rarer pet.' }
};

const PETS = {
  Cat: { rarity: 'Common', value: 50 },
  Dog: { rarity: 'Common', value: 50 },
  Bunny: { rarity: 'Common', value: 60 },
  Fox: { rarity: 'Rare', value: 180 },
  Panda: { rarity: 'Rare', value: 200 },
  Dragon: { rarity: 'Epic', value: 500 },
  Phoenix: { rarity: 'Legendary', value: 1200 }
};

const EGG_TABLES = {
  egg: [['Cat', 30], ['Dog', 30], ['Bunny', 25], ['Fox', 10], ['Panda', 4], ['Dragon', 1]],
  goldenegg: [['Fox', 25], ['Panda', 30], ['Dragon', 30], ['Phoenix', 15]]
};

let db = { users: {}, maintenance: false };

try {
  db = JSON.parse(await readFile(DB_FILE, 'utf8'));
  db.users ||= {};
  db.maintenance ||= false;
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

let saveQueue = Promise.resolve();

function save() {
  saveQueue = saveQueue.then(() =>
    writeFile(DB_FILE, JSON.stringify(db, null, 2))
  );
  return saveQueue;
}

function uid(msg) {
  return String(msg.author_id || msg.user_id || '').trim();
}

function userFor(id) {
  db.users[id] ||= {
    balance: 0,
    lastDaily: 0,
    lastWeekly: 0,
    lastWork: 0,
    createdAt: Date.now(),
    history: [],
    inventory: {},
    pets: [],
    achievements: [],
    region: 'unset',
    stats: { earned: 0, spent: 0, games: 0, wins: 0, discoveries: [] }
  };

  const u = db.users[id];
  u.history ||= [];
  u.inventory ||= {};
  u.pets ||= [];
  u.achievements ||= [];
  u.region ||= 'unset';
  u.stats ||= { earned: 0, spent: 0, games: 0, wins: 0, discoveries: [] };
  u.stats.discoveries ||= [];
  return u;
}

function getUser(msg) {
  const id = uid(msg);
  if (!id) throw new Error('Could not identify your Yapper user ID.');
  return userFor(id);
}

function fmt(n) {
  return Math.floor(Number(n) || 0).toLocaleString('en-US');
}

function args(msg) {
  return (msg.args || '').trim().split(/\s+/).filter(Boolean);
}

function targetId(raw) {
  return String(raw || '').replace(/^<@!?/, '').replace(/>$/, '');
}

function isAdmin(msg) {
  return ADMIN_IDS.has(uid(msg));
}

function maintenanceBlocked(msg) {
  return db.maintenance && !isAdmin(msg);
}

function record(u, delta) {
  u.balance += delta;
  u.stats.earned += Math.max(0, delta);
  u.stats.spent += Math.max(0, -delta);
  u.history.push({ at: Date.now(), delta });
  if (u.history.length > 3000) u.history = u.history.slice(-3000);
}

function card(msg, title, description, fields = []) {
  const embed = new Embed()
    .title(`🔐 ${title}`)
    .description(description)
    .color(YELLOW)
    .footer('Vaulty • Earn • Play • Grow')
    .timestamp();

  for (const f of fields) {
    embed.field(f[0], String(f[1]), f[2] ?? false);
  }

  return msg.reply('', { embeds: [embed] });
}

function errorCard(msg, description) {
  return card(msg, 'Something went wrong', `⚠️ ${description}`);
}

function rewardCard(msg, title, amount, balance, extra = '') {
  return card(
    msg,
    title,
    `💰 You received **${fmt(amount)} Gems**!`,
    [['Your Balance', `${fmt(balance)} Gems`, true]]
  );
}

function weightedPick(table) {
  let n = Math.random() * table.reduce((s, x) => s + x[1], 0);
  for (const [name, weight] of table) {
    n -= weight;
    if (n <= 0) return name;
  }
  return table[0][0];
}

function grantAchievement(u, key, title) {
  if (u.achievements.includes(key)) return '';
  u.achievements.push(key);
  return `\n🏅 Achievement unlocked: **${title}**!`;
}

function cooldownMessage(last, duration, label) {
  const timestamp = Number(last) || 0;
  const left = duration - (Date.now() - timestamp);
  if (left <= 0) return null;
  return `⏳ ${label} ready in about ${Math.ceil(left / HOUR)} hour(s).`;
}

// BALANCE AND REWARDS
bot.command('balance', 'Check your Gems balance', msg => {
  const u = getUser(msg);
  return card(msg, 'Your Balance', `💎 **${fmt(u.balance)} Gems**`);
});

bot.command('daily', 'Claim 100 Gems every 24 hours', async msg => {
  if (maintenanceBlocked(msg)) return errorCard(msg, 'The economy is in maintenance mode.');
  const u = getUser(msg);
  const wait = cooldownMessage(u.lastDaily, DAY, 'Daily reward');
  if (wait) return errorCard(msg, wait);
  record(u, 100);
  u.lastDaily = Date.now();
  const achievement = grantAchievement(u, 'first_daily', 'Daily Starter');
  await save();
  return card(msg, 'Daily Reward', `🎁 You claimed **100 Gems**!${achievement}`, [
    ['Balance', `${fmt(u.balance)} Gems`, true]
  ]);
});

bot.command('weekly', 'Claim 500 Gems every 7 days', async msg => {
  if (maintenanceBlocked(msg)) return errorCard(msg, 'The economy is in maintenance mode.');
  const u = getUser(msg);
  const left = WEEK - (Date.now() - (Number(u.lastWeekly) || 0));
  if (left > 0) return errorCard(msg, `Weekly reward ready in about ${Math.ceil(left / DAY)} day(s).`);
  record(u, 500);
  u.lastWeekly = Date.now();
  await save();
  return card(msg, 'Weekly Reward', '🎁 You claimed **500 Gems**!', [
    ['Balance', `${fmt(u.balance)} Gems`, true]
  ]);
});

bot.command('work', 'Earn 25–75 Gems every hour', async msg => {
  if (maintenanceBlocked(msg)) return errorCard(msg, 'The economy is in maintenance mode.');
  const u = getUser(msg);
  const wait = HOUR - (Date.now() - (Number(u.lastWork) || 0));
  if (wait > 0) return errorCard(msg, `You can work again in ${Math.ceil(wait / 60000)} minute(s).`);
  const earned = 25 + Math.floor(Math.random() * 51);
  record(u, earned);
  u.lastWork = Date.now();
  const achievement = grantAchievement(u, 'first_work', 'Hard Worker');
  await save();
  return card(msg, 'Work Complete', `🛠️ You earned **${earned} Gems**!${achievement}`, [
    ['Balance', `${fmt(u.balance)} Gems`, true]
  ]);
});

bot.command('transfer', 'Transfer Gems: /transfer @user amount', async msg => {
  const [raw, amountRaw] = args(msg);
  const id = targetId(raw);
  const amount = Number(amountRaw);
  if (!id || !Number.isSafeInteger(amount) || amount <= 0) return errorCard(msg, 'Usage: `/transfer @user amount`.');
  if (id === uid(msg)) return errorCard(msg, "You can't transfer Gems to yourself.");
  if (!db.users[id] && !/^\d+$/.test(id)) return errorCard(msg, 'Mention a valid user.');
  const sender = getUser(msg);
  if (sender.balance < amount) return errorCard(msg, "You don't have enough Gems.");
  const recipient = userFor(id);
  record(sender, -amount);
  record(recipient, amount);
  await save();
  return card(msg, 'Transfer Complete', `💸 Sent **${fmt(amount)} Gems** to <@${id}>.`);
});

// LEADERBOARD — worldwide only
bot.command('leaderboard', 'Usage: /leaderboard [alltime|weekly|monthly]', msg => {
  const a = args(msg);
  const period = ['weekly', 'monthly', 'alltime'].includes((a[0] || '').toLowerCase())
    ? a[0].toLowerCase() : 'alltime';
  const rows = Object.entries(db.users);

  const cutoff = period === 'weekly' ? Date.now() - WEEK : period === 'monthly' ? Date.now() - MONTH : 0;
  const score = u => period === 'alltime' ? u.balance :
    (u.history || []).filter(h => h.at >= cutoff && h.delta > 0).reduce((s, h) => s + h.delta, 0);

  rows.sort((a, b) => score(b[1]) - score(a[1]));
  const top = rows.slice(0, 10);
  if (!top.length) return errorCard(msg, 'No players on this leaderboard yet.');

  return card(msg, `🏆 ${period.toUpperCase()} LEADERBOARD`,
    top.map(([id, u], i) => `**${i + 1}.** <@${id}> — ${fmt(score(u))} Gems`).join('\n'));
});

bot.command('profile', 'Show your economy profile', msg => {
  const u = getUser(msg);
  return card(msg, `${msg.author_username || msg.username || 'Player'}'s Profile`, 'Your Vaulty stats:', [
    ['💎 Balance', `${fmt(u.balance)} Gems`, true],
    ['🌍 Region', u.region, true],
    ['🐾 Pets', u.pets.length, true],
    ['🎒 Inventory types', Object.keys(u.inventory).length, true],
    ['🏅 Achievements', u.achievements.length, true],
    ['🎲 Games', `${u.stats.games} played • ${u.stats.wins} wins`]
  ]);
});

// SHOP AND INVENTORY
bot.command('shop', 'Browse shop items', msg => {
  return card(msg, 'Gems Shop',
    Object.entries(SHOP_ITEMS).map(([id, x]) =>
      `**${x.name}** (\`${id}\`) — **${x.price} Gems**\n${x.description}`
    ).join('\n\n') + '\n\nBuy with `/buy item quantity`.');
});

bot.command('buy', 'Buy an item: /buy item [quantity]', async msg => {
  if (maintenanceBlocked(msg)) return errorCard(msg, 'The economy is in maintenance mode.');
  const [keyRaw, qtyRaw] = args(msg);
  const key = (keyRaw || '').toLowerCase();
  const item = SHOP_ITEMS[key];
  const qty = qtyRaw === undefined ? 1 : Number(qtyRaw);
  if (!item || !Number.isSafeInteger(qty) || qty < 1 || qty > 100) return errorCard(msg, 'Usage: `/buy apple 2` (quantity 1–100).');
  const u = getUser(msg);
  const cost = item.price * qty;
  if (u.balance < cost) return errorCard(msg, `You need ${fmt(cost)} Gems but have ${fmt(u.balance)}.`);
  record(u, -cost);
  u.inventory[key] = (u.inventory[key] || 0) + qty;
  if (key === 'egg' || key === 'goldenegg') u.stats.discoveries.push(`Bought ${item.name}`);
  await save();
  return card(msg, 'Purchase Complete', `🛒 Bought **${qty} × ${item.name}** for **${fmt(cost)} Gems**.`, [
    ['Remaining Balance', `${fmt(u.balance)} Gems`, true]
  ]);
});

bot.command('inventory', 'View your items', msg => {
  const u = getUser(msg);
  const lines = Object.entries(u.inventory)
    .filter(([, qty]) => qty > 0)
    .map(([key, qty]) => `**${SHOP_ITEMS[key]?.name || key}** — ${qty}`);
  return card(msg, 'Your Inventory', lines.length ? lines.join('\n') : 'Your inventory is empty.');
});

bot.command('sell', 'Sell an item: /sell item [quantity]', async msg => {
  const [keyRaw, qtyRaw] = args(msg);
  const key = (keyRaw || '').toLowerCase();
  const item = SHOP_ITEMS[key];
  const qty = qtyRaw === undefined ? 1 : Number(qtyRaw);
  const u = getUser(msg);
  if (!item || !Number.isSafeInteger(qty) || qty < 1) return errorCard(msg, 'Usage: `/sell apple 1`.');
  if ((u.inventory[key] || 0) < qty) return errorCard(msg, 'You do not have enough of that item.');
  const value = Math.floor(item.price * 0.5) * qty;
  u.inventory[key] -= qty;
  record(u, value);
  await save();
  return card(msg, 'Item Sold', `💰 Sold **${qty} × ${item.name}** for **${fmt(value)} Gems**.`);
});

bot.command('use', 'Use an item: /use item', async msg => {
  const key = (args(msg)[0] || '').toLowerCase();
  const u = getUser(msg);
  if (!SHOP_ITEMS[key]) return errorCard(msg, 'Choose an item from `/inventory`.');
  if ((u.inventory[key] || 0) < 1) return errorCard(msg, `You don't have any ${key}.`);

  if (key === 'egg' || key === 'goldenegg') {
    u.inventory[key]--;
    const pet = weightedPick(EGG_TABLES[key]);
    u.pets.push({ name: pet, at: Date.now() });
    u.stats.discoveries.push(pet);
    await save();
    return card(msg, 'Egg Hatched!', `🥚 You discovered **${pet}**!`, [
      ['Rarity', PETS[pet].rarity, true]
    ]);
  }

  u.inventory[key]--;
  await save();
  if (key === 'apple') return card(msg, 'Apple Used', '🍎 Delicious!');
  if (key === 'potion') return card(msg, 'Potion Used', '🧪 The Lucky Potion sparkles, but has no gameplay effect yet.');
  return card(msg, 'Item Used', `✨ You used ${SHOP_ITEMS[key].name}.`);
});

// EGGS AND PETS
bot.command('eggs', 'See eggs available in the shop', msg =>
  card(msg, 'Eggs', '**Basic Egg** — 100 Gems\nCommon pets, with a chance of rare pets.\n\n**Golden Egg** — 500 Gems\nBetter chance of rarer pets.\n\nUse `/buy egg` or `/buy goldenegg`, then `/hatch`.'));

bot.command('hatch', 'Hatch an egg: /hatch [egg|goldenegg]', async msg => {
  const key = (args(msg)[0] || 'egg').toLowerCase();
  const u = getUser(msg);
  if (!EGG_TABLES[key]) return errorCard(msg, 'Choose `egg` or `goldenegg`.');
  if ((u.inventory[key] || 0) < 1) return errorCard(msg, `You need a ${SHOP_ITEMS[key].name}. Buy one with \`/buy ${key}\`.`);
  u.inventory[key]--;
  const pet = weightedPick(EGG_TABLES[key]);
  u.pets.push({ name: pet, at: Date.now() });
  u.stats.discoveries.push(pet);
  const achievement = grantAchievement(u, `pet_${pet.toLowerCase()}`, `Discovered ${pet}`);
  await save();
  return card(msg, 'Pet Discovered!', `🥚✨ You hatched **${pet}**!${achievement}`, [
    ['Rarity', PETS[pet].rarity, true],
    ['Sell Value', `${fmt(PETS[pet].value / 2)} Gems`, true]
  ]);
});

bot.command('pet', 'View a pet: /pet number', msg => {
  const u = getUser(msg);
  const n = Number(args(msg)[0]);
  if (!Number.isInteger(n) || n < 1 || n > u.pets.length) return errorCard(msg, 'Usage: `/pet 1` (check `/collection`).');
  const p = u.pets[n - 1];
  return card(msg, p.name, `🐾 **${p.name}**`, [
    ['Rarity', PETS[p.name]?.rarity || 'Unknown', true],
    ['Sell Value', `${fmt(Math.floor((PETS[p.name]?.value || 10) * 0.5))} Gems`, true]
  ]);
});

bot.command('sellpet', 'Sell a pet: /sellpet number', async msg => {
  const u = getUser(msg);
  const n = Number(args(msg)[0]);
  if (!Number.isInteger(n) || n < 1 || n > u.pets.length) return errorCard(msg, 'Usage: `/sellpet 1` (check `/collection`).');
  const p = u.pets.splice(n - 1, 1)[0];
  const value = Math.floor((PETS[p.name]?.value || 10) * 0.5);
  record(u, value);
  await save();
  return card(msg, 'Pet Sold', `🐾 Sold **${p.name}** for **${fmt(value)} Gems**.`);
});

bot.command('collection', 'Show your pet collection', msg => {
  const u = getUser(msg);
  const counts = {};
  for (const p of u.pets) counts[p.name] = (counts[p.name] || 0) + 1;
  return card(msg, 'Pet Collection', Object.keys(PETS).map(n =>
    `${counts[n] ? '✅' : '⬜'} **${n}** (${PETS[n].rarity}) — ${counts[n] || 0} owned`
  ).join('\n'));
});

// MINI-GAMES — fictional in-bot Gems only
bot.command('coinflip', 'Bet Gems: /coinflip amount heads|tails', async msg => {
  if (maintenanceBlocked(msg)) return errorCard(msg, 'The economy is in maintenance mode.');
  const [rawAmount, choiceRaw] = args(msg);
  const amount = Number(rawAmount);
  const choice = (choiceRaw || '').toLowerCase();
  const u = getUser(msg);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000 || !['heads', 'tails'].includes(choice))
    return errorCard(msg, 'Usage: `/coinflip amount heads` (bet 1–1000 Gems).');
  if (u.balance < amount) return errorCard(msg, "You don't have enough Gems.");
  u.stats.games++;
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  if (result === choice) {
    record(u, amount);
    u.stats.wins++;
    const achievement = grantAchievement(u, 'coinflip_win', 'Lucky Flip');
    await save();
    return card(msg, 'Coinflip Won!', `🪙 It landed **${result}**. You won **${fmt(amount)} Gems**!${achievement}`, [
      ['Balance', `${fmt(u.balance)} Gems`, true]
    ]);
  }
  record(u, -amount);
  await save();
  return card(msg, 'Coinflip Lost', `🪙 It landed **${result}**. You lost **${fmt(amount)} Gems**.`, [
    ['Balance', `${fmt(u.balance)} Gems`, true]
  ]);
});

bot.command('slots', 'Bet Gems: /slots amount', async msg => {
  if (maintenanceBlocked(msg)) return errorCard(msg, 'The economy is in maintenance mode.');
  const amount = Number(args(msg)[0]);
  const u = getUser(msg);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 500) return errorCard(msg, 'Usage: `/slots amount` (1–500 Gems).');
  if (u.balance < amount) return errorCard(msg, "You don't have enough Gems.");
  u.stats.games++;
  const icons = ['🍒', '🍋', '🍇', '⭐', '💎'];
  const r = [0, 0, 0].map(() => icons[Math.floor(Math.random() * icons.length)]);
  if (r[0] === r[1] && r[1] === r[2]) {
    const win = amount * 4;
    record(u, win);
    u.stats.wins++;
    const achievement = grantAchievement(u, 'slots_win', 'Jackpot');
    await save();
    return card(msg, 'JACKPOT!', `${r.join(' | ')}\n🎉 Triple match! You won **${fmt(win)} Gems**!${achievement}`, [
      ['Balance', `${fmt(u.balance)} Gems`, true]
    ]);
  }
  if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) {
    const win = Math.floor(amount * 0.5);
    record(u, win);
    await save();
    return card(msg, 'Pair!', `${r.join(' | ')}\n✨ You won back **${fmt(win)} Gems**.`, [
      ['Balance', `${fmt(u.balance)} Gems`, true]
    ]);
  }
  record(u, -amount);
  await save();
  return card(msg, 'No Match', `${r.join(' | ')}\nYou lost **${fmt(amount)} Gems**.`, [
    ['Balance', `${fmt(u.balance)} Gems`, true]
  ]);
});

// HELP
bot.command('help', 'List all bot commands', msg =>
  card(msg, 'Vaulty Commands',
    '**Economy**\n/balance • /daily • /weekly • /work • /transfer • /profile\n\n' +
    '**Leaderboard**\n/leaderboard\n\n' +
    '**Pets**\n/eggs • /hatch • /pet • /sellpet • /collection\n\n' +
    '**Shop**\n/shop • /buy • /inventory • /sell • /use\n\n' +
    '**Games**\n/coinflip • /slots\n\n' +
    '**Admin**\n/addgems • /removegems • /setgems • /giveegg • /maintenance'
  )
);

// ADMIN COMMANDS
bot.command('addgems', 'Admin: /addgems @user amount', async msg => {
  if (!isAdmin(msg)) return errorCard(msg, 'You are not authorised to use this command.');
  const [raw, nRaw] = args(msg);
  const id = targetId(raw);
  const n = Number(nRaw);
  if (!id || !Number.isSafeInteger(n) || n < 1 || n > 1000000000) return errorCard(msg, 'Usage: `/addgems @user amount`.');
  const u = userFor(id);
  record(u, n);
  await save();
  return card(msg, 'Gems Added', `Added **${fmt(n)} Gems** to <@${id}>.`);
});

bot.command('removegems', 'Admin: /removegems @user amount', async msg => {
  if (!isAdmin(msg)) return errorCard(msg, 'You are not authorised to use this command.');
  const [raw, nRaw] = args(msg);
  const id = targetId(raw);
  const n = Number(nRaw);
  if (!id || !Number.isSafeInteger(n) || n < 1 || n > 1000000000) return errorCard(msg, 'Usage: `/removegems @user amount`.');
  const u = userFor(id);
  record(u, -Math.min(n, u.balance));
  await save();
  return card(msg, 'Gems Removed', `Removed up to **${fmt(n)} Gems** from <@${id}>.`);
});

bot.command('setgems', 'Admin: /setgems @user amount', async msg => {
  if (!isAdmin(msg)) return errorCard(msg, 'You are not authorised to use this command.');
  const [raw, nRaw] = args(msg);
  const id = targetId(raw);
  const n = Number(nRaw);
  if (!id || !Number.isSafeInteger(n) || n < 0 || n > 1000000000) return errorCard(msg, 'Usage: `/setgems @user amount`.');
  const u = userFor(id);
  record(u, n - u.balance);
  await save();
  return card(msg, 'Balance Set', `Set <@${id}>'s balance to **${fmt(n)} Gems**.`);
});

bot.command('giveegg', 'Admin: /giveegg @user [egg|goldenegg]', async msg => {
  if (!isAdmin(msg)) return errorCard(msg, 'You are not authorised to use this command.');
  const [raw, kindRaw] = args(msg);
  const id = targetId(raw);
  const kind = (kindRaw || 'egg').toLowerCase();
  if (!id || !EGG_TABLES[kind]) return errorCard(msg, 'Usage: `/giveegg @user egg` or `/giveegg @user goldenegg`.');
  const u = userFor(id);
  u.inventory[kind] = (u.inventory[kind] || 0) + 1;
  await save();
  return card(msg, 'Egg Granted', `🥚 Gave a **${SHOP_ITEMS[kind].name}** to <@${id}>.`);
});

bot.command('maintenance', 'Admin: /maintenance on|off', async msg => {
  if (!isAdmin(msg)) return errorCard(msg, 'You are not authorised to use this command.');
  const v = (args(msg)[0] || '').toLowerCase();
  if (!['on', 'off'].includes(v))
    return card(msg, 'Maintenance', `Current status: **${db.maintenance ? 'ON' : 'OFF'}**\nUse \`/maintenance on\` or \`/maintenance off\`.`);
  db.maintenance = v === 'on';
  await save();
  return card(msg, 'Maintenance Updated', `🔧 Maintenance mode is now **${v.toUpperCase()}**.`);
});

bot.on('error', err => console.error('[Vaulty]', err?.message || err));

bot.start();
