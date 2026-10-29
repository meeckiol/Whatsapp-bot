import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/auto_replies.json');

class AutoRepliesManager {
  constructor() {
    this.rules = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        this.rules = JSON.parse(raw);
      } else {
        this.rules = [];
      }
    } catch (err) {
      console.error('Erreur chargement auto_replies.json :', err);
      this.rules = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.rules, null, 2), 'utf-8');
    } catch (err) {
      console.error('Erreur sauvegarde auto_replies.json :', err);
    }
  }

  findReply(text) {
    if (!text) return null;
    const lowerText = text.toLowerCase().trim();

    for (const rule of this.rules) {
      const trigger = rule.trigger.toLowerCase();
      if (rule.type === 'exact') {
        if (lowerText === trigger) return rule.reply;
      } else if (rule.type === 'regex') {
        try {
          const re = new RegExp(rule.trigger, 'i');
          if (re.test(text)) return rule.reply;
        } catch (_) {}
      } else {
        // Défaut : contains
        if (lowerText.includes(trigger)) return rule.reply;
      }
    }
    return null;
  }

  addRule(trigger, reply, type = 'contains') {
    // Vérifier si existe déjà
    const existingIndex = this.rules.findIndex(
      (r) => r.trigger.toLowerCase() === trigger.toLowerCase()
    );
    if (existingIndex >= 0) {
      this.rules[existingIndex].reply = reply;
      this.rules[existingIndex].type = type;
    } else {
      this.rules.push({
        id: Date.now().toString(),
        trigger,
        type,
        reply
      });
    }
    this.save();
    return true;
  }

  removeRule(trigger) {
    const initialLen = this.rules.length;
    this.rules = this.rules.filter(
      (r) => r.trigger.toLowerCase() !== trigger.toLowerCase()
    );
    if (this.rules.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  listRules() {
    return this.rules;
  }
}

export const autoReplies = new AutoRepliesManager();
