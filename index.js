
import { Bot } from './yapper.js';
import { readFile, writeFile } from 'node:fs/promises';

const bot = new Bot(process.env.YAPPER_BOT_TOKEN);
const DB_FILE = './economy.json';
const DAY = 86400000;
const HOUR = 3600000;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',').map(x => x.trim()).filter(Boolean);

let db = { users: {}, maintenance: false };
try {
  db = { ...db, ...JSON.parse(await readFile(DB_FILE, 'utf8')) };
  db.users ||= {};
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

function idOf(msg) {
  return msg.authorMention;
}
function user(id) {
  db.users[id] ||= {
    balance: 0, bank: 0, daily: 0, weekly: 0, work: 0,
    inventory: {}, pets: [], discoveries: [], achievements: [],
    region: 'Unspecified', stats: { earned: 0, spent: 0 },
    created: Date.now()
  };
  const u = db.users[id];
  u.inventory ||= {};
  u.pets ||= [];
  u.discoveries ||= [];
  u.achievements ||= [];
  u.stats ||= { earned: 0, spent: 0 };
  return u;
}
function money(n) {
  return Math.floor(n).toLocaleString('en-US');
}
function reply(msg, text) {
  return msg.reply(text);
}
function mentionId(s) {
  return s?.match(/^<@!?(\d+)>$/)?.[1]
    ? `<@${s.match(/^<@!?(\d+)>$/)[1]}>`
    : s;
}
function isAdmin(msg) {
  const raw = idOf(msg).replace(/[<@!>]/g, '');
  return ADMIN_IDS.includes(raw) || ADMIN_IDS.includes(idOf(msg));
}
function adminOnly(msg) {
  return isAdmin(msg) || reply(msg, '⛔ Admin only.');
}
function addGems(u, amount) {
  u.balance += amount;
  if (amount > 0) u.stats.earned += amount;
}
function cooldownMessage(last, duration) {
  const timestamp = Number(last) || 0;
  const wait = duration - (Date.now() - timestamp);

  if (wait <= 0) return null;

  const hours = Math.ceil(wait / 3600000);
  return `⏳ Try again in ${hours} hour(s).`;
}

const ITEMS = {
  apple: { name: 'Apple', price: 20, sell: 8, type: 'food' },
  potion: { name: 'Lucky Potion', price: 150, sell: 60, type: 'use' },
  egg: { name: 'Common Egg', price: 100, sell: 40, type: 'egg' },
  goldenegg: { name: 'Golden Egg', price: 500, sell: 200, type: 'egg' },
  ticket: { name: 'Lottery Ticket', price: 75, sell: 20, type: 'use' }
};

const PETS = [
  { name: 'Cat', rarity: 'Common', chance: 40, value: 50 },
  { name: 'Dog', rarity: 'Common', chance: 30, value: 60 },
  { name: 'Rabbit', rarity: 'Uncommon', chance: 17, value: 100 },
  { name: 'Fox', rarity: 'Rare', chance: 8, value: 250 },
  { name: 'Dragon', rarity: 'Legendary', chance: 4, value: 1000 },
  { name: 'Phoenix', rarity: 'Mythic', chance: 1, value: 2500 }
];

function pickPet() {
  let roll = Math.random() * 100;
  for (const p of PETS) {
    roll -= p.chance;
    if (roll <= 0) return { ...p, uid: `${Date.now()}-${Math.random()}` };
  }
  return { ...PETS[0], uid: `${Date.now()}-${Math.random()}` };
}

function checkAchievements(u) {
  const checks = [
    ['First Gems', u.balance >= 100],
    ['Getting Rich', u.balance >= 1000],
    ['Gem Millionaire', u.balance >= 1000000],
    ['Pet Collector', u.pets.length >= 5],
    ['Explorer', u.discoveries.length >= 5]
  ];
  const unlocked = [];
  for (const [name, yes] of checks) {
    if (yes && !u.achievements.includes(name)) {
      u.achievements.push(name);
      unlocked.push(name);
    }
  }
  return unlocked;
}

bot.command('ping', 'Check bot status', msg =>
  reply(msg, '🏓 Pong! The bot is online.')
);

bot.command('help', 'Show all commands', msg => reply(msg,
`💎 ECONOMY
/balance, /daily, /weekly, /work
/transfer @user amount
/profile, /region name
/leaderboard [weekly|monthly|alltime]
/richest

🥚 PETS
/eggs, /hatch [egg|goldenegg]
/pets, /pet number, /sellpet number
/collection, /discoveries

🛒 SHOP
/shop, /buy item [amount]
/inventory, /sell item [amount], /use item

🎮 GAMES
/coinflip amount heads|tails
/slots amount

🏅 PROGRESS
/achievements

🛠️ ADMIN
/addgems @user amount
/removegems @user amount
/setgems @user amount
/giveegg @user [goldenegg]
/maintenance on|off

/help, /ping`
));

bot.command('balance', 'Check Gems', msg => {
  const u = user(idOf(msg));
  return reply(msg, `💎 Wallet: ${money(u.balance)} Gems\n🏦 Bank: ${money(u.bank)} Gems`);
});

bot.command('daily', 'Claim daily Gems', async msg => {
  if (db.maintenance && !isAdmin(msg)) return reply(msg, '🔧 Maintenance mode is on.');
  const u = user(idOf(msg));
  const wait = cooldownMessage(u.daily, DAY);
  if (wait) return reply(msg, wait);
  addGems(u, 100);
  u.daily = Date.now();
  await save();
  return reply(msg, `💎 You claimed 100 Gems! Balance: ${money(u.balance)}`);
});

bot.command('weekly', 'Claim weekly Gems', async msg => {
  const u = user(idOf(msg));
  const wait = cooldownMessage(u.weekly, 7 * DAY);
  if (wait) return reply(msg, wait);
  addGems(u, 500);
  u.weekly = Date.now();
  await save();
  return reply(msg, `🎁 You claimed 500 Gems! Balance: ${money(u.balance)}`);
});

bot.command('work', 'Earn Gems', async msg => {
  const u = user(idOf(msg));
  const wait = cooldownMessage(Number(u.work) || 0, HOUR);
  if (wait) return reply(msg, wait);
  const earned = Math.floor(Math.random() * 51) + 25;
  addGems(u, earned);
  u.work = Date.now();
  await save();
  return reply(msg, `🛠️ You earned ${earned} Gems!`);
});

bot.command('transfer', 'Transfer Gems', async msg => {
  const [targetRaw, amountRaw] = msg.argv || [];
  const target = mentionId(targetRaw);
  const amount = Number(amountRaw);
  if (!target || !Number.isSafeInteger(amount) || amount <= 0)
    return reply(msg, 'Use /transfer @user amount');
  if (target === idOf(msg)) return reply(msg, '❌ You cannot pay yourself.');
  const u = user(idOf(msg));
  if (u.balance < amount) return reply(msg, '❌ Not enough Gems.');
  u.balance -= amount;
  user(target).balance += amount;
  await save();
  return reply(msg, `✅ Sent ${money(amount)} Gems to ${target}.`);
});

bot.command('profile', 'View your profile', msg => {
  const u = user(idOf(msg));
  return reply(msg,
`👤 Profile: ${idOf(msg)}
💎 Wallet: ${money(u.balance)}
🏦 Bank: ${money(u.bank)}
🥚 Pets: ${u.pets.length}
🏅 Achievements: ${u.achievements.length}
🌍 Region: ${u.region}`);
});

bot.command('region', 'Set your region', async msg => {
  const region = (msg.args || '').trim().slice(0, 30);
  if (!region) return reply(msg, 'Use /region Europe (or your region name).');
  user(idOf(msg)).region = region;
  await save();
  return reply(msg, `🌍 Your region is now ${region}.`);
});

bot.command('leaderboard', 'View richest players', msg => {
  const mode = (msg.argv?.[0] || 'alltime').toLowerCase();
  const all = Object.entries(db.users);
  let list = all;
  if (mode === 'weekly') list = all.filter(([,u]) => u.weekly && Date.now()-u.weekly < 7*DAY);
  if (mode === 'monthly') list = all.filter(([,u]) => u.created && Date.now()-u.created < 30*DAY);
  if (!['weekly','monthly','alltime','world','regional'].includes(mode))
    return reply(msg, 'Use /leaderboard weekly, monthly, or alltime.');
  if (mode === 'regional') {
    const region = user(idOf(msg)).region;
    list = all.filter(([,u]) => u.region === region);
  }
  list.sort((a,b) => (b[1].balance+b[1].bank)-(a[1].balance+a[1].bank));
  const lines = list.slice(0,10).map(([id,u],i) =>
    `${i+1}. ${id} — ${money(u.balance+u.bank)} Gems`);
  return reply(msg, `🏆 ${mode.toUpperCase()} LEADERBOARD\n${lines.join('\n') || 'No players yet.'}`);
});

bot.command('richest', 'Show richest players', msg =>
  bot.commands.get('leaderboard').fn(msg)
);

bot.command('shop', 'View shop items', msg => {
  const lines = Object.entries(ITEMS).map(([key,x]) =>
    `• ${key} — ${x.name}: ${x.price} Gems`);
  return reply(msg, `🛒 SHOP\n${lines.join('\n')}\nBuy with /buy item amount`);
});

bot.command('buy', 'Buy an item', async msg => {
  const [keyRaw, amountRaw] = msg.argv || [];
  const key = (keyRaw || '').toLowerCase();
  const amount = amountRaw === undefined ? 1 : Number(amountRaw);
  const item = ITEMS[key];
  if (!item || !Number.isSafeInteger(amount) || amount < 1 || amount > 100)
    return reply(msg, 'Use /buy item amount. Check /shop.');
  const u = user(idOf(msg));
  const cost = item.price * amount;
  if (u.balance < cost) return reply(msg, '❌ Not enough Gems.');
  u.balance -= cost;
  u.stats.spent += cost;
  u.inventory[key] = (u.inventory[key] || 0) + amount;
  await save();
  return reply(msg, `🛒 Bought ${amount} × ${item.name}.`);
});

bot.command('inventory', 'View your items', msg => {
  const inv = user(idOf(msg)).inventory;
  const lines = Object.entries(inv).filter(([,n]) => n > 0)
    .map(([key,n]) => `${key}: ${n}`);
  return reply(msg, `🎒 INVENTORY\n${lines.join('\n') || 'Empty.'}`);
});

bot.command('sell', 'Sell an item', async msg => {
  const [keyRaw, amountRaw] = msg.argv || [];
  const key = (keyRaw || '').toLowerCase();
  const amount = amountRaw === undefined ? 1 : Number(amountRaw);
  const item = ITEMS[key];
  const u = user(idOf(msg));
  if (!item || !Number.isSafeInteger(amount) || amount < 1)
    return reply(msg, 'Use /sell item amount');
  if ((u.inventory[key] || 0) < amount)
    return reply(msg, '❌ You do not have enough.');
  u.inventory[key] -= amount;
  addGems(u, item.sell * amount);
  await save();
  return reply(msg, `💰 Sold ${amount} × ${item.name} for ${money(item.sell*amount)} Gems.`);
});

bot.command('use', 'Use an item', async msg => {
  const key = (msg.argv?.[0] || '').toLowerCase();
  const u = user(idOf(msg));
  if (!ITEMS[key] || ITEMS[key].type !== 'use')
    return reply(msg, 'That item cannot be used.');
  if ((u.inventory[key] || 0) < 1) return reply(msg, 'You do not have that item.');
  u.inventory[key]--;
  if (key === 'potion') {
    const prize = Math.floor(Math.random() * 101) + 50;
    addGems(u, prize);
    await save();
    return reply(msg, `🧪 Potion used! You found ${prize} Gems.`);
  }
  const prize = Math.floor(Math.random() * 151);
  addGems(u, prize);
  await save();
  return reply(msg, `🎟️ Ticket used! You won ${prize} Gems.`);
});

bot.command('eggs', 'See available eggs', msg =>
  reply(msg, '🥚 Common Egg: 100 Gems\n🌟 Golden Egg: 500 Gems\nUse /buy egg or /buy goldenegg, then /hatch egg.')
);

bot.command('hatch', 'Hatch an egg', async msg => {
  const key = (msg.argv?.[0] || 'egg').toLowerCase();
  const u = user(idOf(msg));
  if (!['egg','goldenegg'].includes(key)) return reply(msg, 'Use /hatch egg or /hatch goldenegg');
  if ((u.inventory[key] || 0) < 1) return reply(msg, `Buy one first: /buy ${key}`);
  u.inventory[key]--;
  const pet = pickPet();
  if (key === 'goldenegg' && ['Common','Uncommon'].includes(pet.rarity)) {
    pet.rarity = 'Rare';
    pet.value = 250;
  }
  u.pets.push(pet);
  if (!u.discoveries.includes(pet.name)) u.discoveries.push(pet.name);
  const newAchievements = checkAchievements(u);
  await save();
  return reply(msg, `🥚 You hatched a ${pet.rarity} ${pet.name}!\n${newAchievements.length ? '🏅 Achievement unlocked: '+newAchievements.join(', ') : ''}`);
});

bot.command('pets', 'List your pets', msg => {
  const pets = user(idOf(msg)).pets;
  return reply(msg, `🐾 YOUR PETS\n${pets.map((p,i)=>`${i+1}. ${p.rarity} ${p.name}`).join('\n') || 'No pets yet. Buy an egg and hatch it!'}`);
});

bot.command('pet', 'View one pet', msg => {
  const n = Number(msg.argv?.[0]);
  const p = user(idOf(msg)).pets[n-1];
  if (!p) return reply(msg, 'Use /pet number, e.g. /pet 1');
  return reply(msg, `🐾 ${p.name}\nRarity: ${p.rarity}\nSell value: ${p.value} Gems`);
});

bot.command('sellpet', 'Sell one pet', async msg => {
  const n = Number(msg.argv?.[0]);
  const u = user(idOf(msg));
  const p = u.pets[n-1];
  if (!p) return reply(msg, 'Use /sellpet number');
  u.pets.splice(n-1, 1);
  addGems(u, p.value);
  await save();
  return reply(msg, `💰 Sold ${p.name} for ${p.value} Gems.`);
});

bot.command('collection', 'View your pet collection', msg => {
  const u = user(idOf(msg));
  return reply(msg, `📚 Collection\n${u.discoveries.join(', ') || 'No discoveries yet.'}`);
});

bot.command('discoveries', 'View discovered pets', msg =>
  bot.commands.get('collection').fn(msg)
);

bot.command('coinflip', 'Bet Gems on a coin flip', async msg => {
  const amount = Number(msg.argv?.[0]);
  const choice = (msg.argv?.[1] || '').toLowerCase();
  const u = user(idOf(msg));
  if (!Number.isSafeInteger(amount) || amount < 1 || !['heads','tails'].includes(choice))
    return reply(msg, 'Use /coinflip amount heads|tails');
  if (u.balance < amount) return reply(msg, 'Not enough Gems.');
  if (Math.random() < 0.5) {
    u.balance -= amount;
    u.stats.spent += amount;
    await save();
    return reply(msg, `🪙 It was ${choice === 'heads' ? 'tails' : 'heads'}! You lost ${amount} Gems.`);
  }
  addGems(u, amount);
  await save();
  return reply(msg, `🪙 It was ${choice}! You won ${amount} Gems.`);
});

bot.command('slots', 'Play slots', async msg => {
  const amount = Number(msg.argv?.[0]);
  const u = user(idOf(msg));
  if (!Number.isSafeInteger(amount) || amount < 1) return reply(msg, 'Use /slots amount');
  if (u.balance < amount) return reply(msg, 'Not enough Gems.');
  const icons = ['🍒','🍋','🔔','💎','⭐'];
  const result = [0,1,2].map(()=>icons[Math.floor(Math.random()*icons.length)]);
  let winnings = 0;
  if (result[0] === result[1] && result[1] === result[2]) winnings = amount * 4;
  else if (new Set(result).size < 3) winnings = amount * 2;
  u.balance -= amount;
  u.stats.spent += amount;
  if (winnings) addGems(u, winnings);
  await save();
  return reply(msg, `${result.join(' | ')}\n${winnings ? `🎉 Won ${winnings} Gems!` : 'No win this time.'}`);
});

bot.command('achievements', 'View achievements', msg => {
  const u = user(idOf(msg));
  const unlocked = checkAchievements(u);
  save();
  return reply(msg, `🏅 ACHIEVEMENTS\n${u.achievements.join('\n') || 'None yet.'}${unlocked.length ? '\nNew: '+unlocked.join(', ') : ''}`);
});

bot.command('addgems', 'Admin: add Gems', async msg => {
  if (!isAdmin(msg)) return reply(msg, '⛔ Admin only.');
  const [targetRaw, amountRaw] = msg.argv || [];
  const amount = Number(amountRaw);
  const target = mentionId(targetRaw);
  if (!target || !Number.isSafeInteger(amount) || amount <= 0) return reply(msg, 'Use /addgems @user amount');
  addGems(user(target), amount);
  await save();
  return reply(msg, `✅ Added ${amount} Gems to ${target}.`);
});

bot.command('removegems', 'Admin: remove Gems', async msg => {
  if (!isAdmin(msg)) return reply(msg, '⛔ Admin only.');
  const [targetRaw, amountRaw] = msg.argv || [];
  const amount = Number(amountRaw);
  const target = mentionId(targetRaw);
  if (!target || !Number.isSafeInteger(amount) || amount <= 0) return reply(msg, 'Use /removegems @user amount');
  const u = user(target);
  u.balance = Math.max(0, u.balance - amount);
  await save();
  return reply(msg, `✅ Removed Gems from ${target}.`);
});

bot.command('setgems', 'Admin: set balance', async msg => {
  if (!isAdmin(msg)) return reply(msg, '⛔ Admin only.');
  const [targetRaw, amountRaw] = msg.argv || [];
  const amount = Number(amountRaw);
  const target = mentionId(targetRaw);
  if (!target || !Number.isSafeInteger(amount) || amount < 0) return reply(msg, 'Use /setgems @user amount');
  user(target).balance = amount;
  await save();
  return reply(msg, `✅ Set ${target}'s balance to ${amount} Gems.`);
});

bot.command('giveegg', 'Admin: give an egg', async msg => {
  if (!isAdmin(msg)) return reply(msg, '⛔ Admin only.');
  const [targetRaw, typeRaw] = msg.argv || [];
  const target = mentionId(targetRaw);
  const type = (typeRaw || 'egg').toLowerCase();
  if (!target || !['egg','goldenegg'].includes(type)) return reply(msg, 'Use /giveegg @user [egg|goldenegg]');
  const u = user(target);
  u.inventory[type] = (u.inventory[type] || 0) + 1;
  await save();
  return reply(msg, `🥚 Gave ${type} to ${target}.`);
});

bot.command('maintenance', 'Admin: toggle maintenance', async msg => {
  if (!isAdmin(msg)) return reply(msg, '⛔ Admin only.');
  const mode = (msg.argv?.[0] || '').toLowerCase();
  if (!['on','off'].includes(mode)) return reply(msg, 'Use /maintenance on or /maintenance off');
  db.maintenance = mode === 'on';
  await save();
  return reply(msg, `🔧 Maintenance ${mode}.`);
});

bot.on('error', err => console.error('Bot error:', err));
bot.start();
