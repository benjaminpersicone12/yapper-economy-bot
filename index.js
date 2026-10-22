
import { Bot } from './yapper.js';
import { readFile, writeFile } from 'node:fs/promises';

const bot = new Bot(process.env.YAPPER_BOT_TOKEN);
const CURRENCY = 'Gems';
const DB_FILE = './economy.json';

let db = { users: {} };

try {
  db = JSON.parse(await readFile(DB_FILE, 'utf8'));
  db.users ??= {};
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function getUser(msg) {
  const id = msg.authorMention;
  if (!id) throw new Error('Could not identify the user.');
  db.users[id] ??= { balance: 0, lastDaily: 0, lastWork: 0 };
  return db.users[id];
}

let saveQueue = Promise.resolve();

function save() {
  saveQueue = saveQueue.then(() =>
    writeFile(DB_FILE, JSON.stringify(db, null, 2))
  );
  return saveQueue;
}

function format(amount) {
  return Math.floor(amount).toLocaleString('en-US');
}

bot.command('balance', 'Check your Gems balance', async (msg) => {
  const user = getUser(msg);
  await save();
  return msg.reply(`💎 Balance: ${format(user.balance)} ${CURRENCY}`);
});

bot.command('daily', 'Claim your daily Gems', async (msg) => {
  const user = getUser(msg);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  if (now - user.lastDaily < day) {
    const hours = Math.ceil((day - (now - user.lastDaily)) / 3600000);
    return msg.reply(`⏳ Come back in about ${hours} hour(s).`);
  }

  user.balance += 100;
  user.lastDaily = now;
  await save();

  return msg.reply(`💎 You claimed 100 Gems! Balance: ${format(user.balance)}`);
});

bot.command('work', 'Work to earn Gems', async (msg) => {
  const user = getUser(msg);
  const now = Date.now();
  const cooldown = 60 * 60 * 1000;

  if (now - user.lastWork < cooldown) {
    const minutes = Math.ceil((cooldown - (now - user.lastWork)) / 60000);
    return msg.reply(`⏳ Try working again in ${minutes} minute(s).`);
  }

  const earned = Math.floor(Math.random() * 51) + 25;
  user.balance += earned;
  user.lastWork = now;
  await save();

  return msg.reply(`🛠️ You earned ${earned} Gems! Balance: ${format(user.balance)}`);
});

bot.command('transfer', 'Transfer Gems to another user', async (msg) => {
  const args = msg.argv ?? [];
  const targetId = args[0];
  const amount = Number(args[1]);

  if (!targetId || !Number.isSafeInteger(amount) || amount <= 0) {
    return msg.reply('Use /transfer @user amount');
  }

  const sender = getUser(msg);
  if (targetId === msg.authorMention) {
    return msg.reply("You can't transfer Gems to yourself.");
  }

  if (sender.balance < amount) {
    return msg.reply("You don't have enough Gems.");
  }

  db.users[targetId] ??= { balance: 0, lastDaily: 0, lastWork: 0 };
  sender.balance -= amount;
  db.users[targetId].balance += amount;

  await save();
  return msg.reply(`💎 Transferred ${format(amount)} Gems.`);
});

bot.command('leaderboard', 'Show the richest players', async (msg) => {
  const top = Object.entries(db.users)
    .sort((a, b) => b[1].balance - a[1].balance)
    .slice(0, 10);

  if (!top.length) return msg.reply('No balances yet. Use /daily to start!');

  const lines = top.map(([id, user], index) =>
    `${index + 1}. ${id}: ${format(user.balance)} Gems`
  );

  return msg.reply(`🏆 Gems Leaderboard\n${lines.join('\n')}`);
});

bot.command('ping', 'Check whether the bot is online', (msg) =>
  msg.reply('🏓 Pong!')
);

bot.start();

