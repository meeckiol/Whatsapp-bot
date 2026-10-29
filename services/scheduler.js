import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/reminders.json');

class ReminderScheduler {
  constructor() {
    this.sock = null;
    this.reminders = [];
    this.timers = new Map();
    this.cronJobs = new Map();
    this.load();
  }

  setSocket(sock) {
    this.sock = sock;
    this.rescheduleAll();
  }

  load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        this.reminders = JSON.parse(raw);
      } else {
        this.reminders = [];
      }
    } catch (err) {
      console.error('Erreur chargement reminders.json :', err);
      this.reminders = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.reminders, null, 2), 'utf-8');
    } catch (err) {
      console.error('Erreur sauvegarde reminders.json :', err);
    }
  }

  parseDuration(str) {
    const match = str.match(/^(\d+)\s*(s|m|h|d|j)$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd':
      case 'j': return value * 24 * 60 * 60 * 1000;
      default: return null;
    }
  }

  addOneTimeReminder(remoteJid, durationStr, message) {
    const delayMs = this.parseDuration(durationStr);
    if (!delayMs) return null;

    const dueTime = Date.now() + delayMs;
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

    const reminder = {
      id,
      remoteJid,
      type: 'once',
      message,
      dueTime,
      createdAt: new Date().toISOString()
    };

    this.reminders.push(reminder);
    this.save();
    this.scheduleOne(reminder);

    return { id, dueTime };
  }

  addDailyAlert(remoteJid, timeHHMM, message) {
    const match = timeHHMM.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
    if (!match) return null;

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const cronExpr = `${minutes} ${hours} * * *`;
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

    const reminder = {
      id,
      remoteJid,
      type: 'cron',
      cronExpr,
      timeStr: timeHHMM,
      message,
      createdAt: new Date().toISOString()
    };

    this.reminders.push(reminder);
    this.save();
    this.scheduleOne(reminder);

    return { id, cronExpr };
  }

  scheduleOne(reminder) {
    if (!this.sock) return;

    if (reminder.type === 'once') {
      const remainingMs = reminder.dueTime - Date.now();
      if (remainingMs <= 0) {
        // Déjà expiré, envoi immédiat
        this.triggerReminder(reminder);
        return;
      }

      const timer = setTimeout(() => {
        this.triggerReminder(reminder);
      }, remainingMs);

      this.timers.set(reminder.id, timer);
    } else if (reminder.type === 'cron') {
      if (cron.validate(reminder.cronExpr)) {
        const job = cron.schedule(
          reminder.cronExpr,
          () => {
            this.sock?.sendMessage(reminder.remoteJid, {
              text: `🔔 *ALERTE PROGRAMMÉE* :\n${reminder.message}`
            }).catch(e => console.error('Erreur envoi alerte cron :', e));
          },
          { timezone: 'Europe/Paris' }
        );

        this.cronJobs.set(reminder.id, job);
      }
    }
  }

  async triggerReminder(reminder) {
    try {
      if (this.sock) {
        await this.sock.sendMessage(reminder.remoteJid, {
          text: `⏰ *RAPPEL PROGRAMMÉ* :\n${reminder.message}`
        });
      }
    } catch (err) {
      console.error('Erreur déclenchement rappel :', err);
    } finally {
      this.cancelReminder(reminder.id);
    }
  }

  cancelReminder(id) {
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    }
    if (this.cronJobs.has(id)) {
      this.cronJobs.get(id).stop();
      this.cronJobs.delete(id);
    }
    this.reminders = this.reminders.filter(r => r.id !== id);
    this.save();
  }

  rescheduleAll() {
    // Nettoyer les timers existants
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const job of this.cronJobs.values()) job.stop();
    this.cronJobs.clear();

    for (const r of [...this.reminders]) {
      this.scheduleOne(r);
    }
  }

  listReminders(remoteJid) {
    return this.reminders.filter(r => r.remoteJid === remoteJid);
  }
}

export const scheduler = new ReminderScheduler();
