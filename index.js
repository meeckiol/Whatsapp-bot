import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import dotenv from 'dotenv';
import { promptAuthMode } from './services/auth.js';
import { autoReplies } from './services/replies.js';
import { askAI, askAsHuman, askAsHumanWithAudio, transcribeAudio } from './services/ai.js';
import { scheduler } from './services/scheduler.js';

dotenv.config();

const logger = pino({ level: 'silent' });
let aiAutoReplyEnabled = process.env.AI_AUTO_REPLY === 'true';

async function startWhatsAppBot() {
  console.log('🤖 Démarrage du bot WhatsApp...');

  // Chargement ou initialisation des identifiants de session
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

  let authConfig = { mode: 'qr' };
  let pairingCodeRequested = false;

  // Si le compte n'est pas encore enregistré, demander la méthode de connexion
  if (!state.creds.registered) {
    authConfig = await promptAuthMode(process.env.PHONE_NUMBER);
  }

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), // Émulation navigateur moderne (compatible pairing code)
    syncFullHistory: false
  });

  // Associer le socket au planificateur d'alertes
  scheduler.setSocket(sock);

  // Sauvegarde des identifiants
  sock.ev.on('creds.update', saveCreds);

  // Gestion des événements de connexion
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // 1. Mode Code d'association (Pairing Code)
    if (authConfig.mode === 'pairing' && !state.creds.registered && !pairingCodeRequested) {
      pairingCodeRequested = true;
      // Laisser un court délai pour que la connexion initiale au serveur soit établie
      setTimeout(async () => {
        try {
          console.log(`\n⏳ Demande du code d'association pour le numéro : ${authConfig.phoneNumber}...`);
          const code = await sock.requestPairingCode(authConfig.phoneNumber);
          const formatted = code?.match(/.{1,4}/g)?.join('-') || code;

          console.log('\n╔══════════════════════════════════════════════════════════════╗');
          console.log('║               🔑 CODE D\'ASSOCIATION WHATSAPP                 ║');
          console.log('╠══════════════════════════════════════════════════════════════╣');
          console.log(`║                         ${formatted}                         ║`);
          console.log('╠══════════════════════════════════════════════════════════════╣');
          console.log('║ Instructions sur votre smartphone :                          ║');
          console.log('║ 1. Ouvrez WhatsApp                                          ║');
          console.log('║ 2. Allez dans Réglages > Appareils connectés                 ║');
          console.log('║ 3. Appuyez sur "Connecter un appareil"                       ║');
          console.log('║ 4. Appuyez sur "Associer avec un numéro de tél." (en bas)   ║');
          console.log('║ 5. Saisissez ce code à 8 caractères                          ║');
          console.log('╚══════════════════════════════════════════════════════════════╝\n');
        } catch (err) {
          console.error('❌ Échec de la demande du code d\'association :', err.message);
          console.log('💡 Vous pouvez relancer en scannant le QR code ou vérifier le format de votre numéro.');
        }
      }, 3500);
    }

    // 2. Mode QR Code
    if (authConfig.mode === 'qr' && qr && !state.creds.registered) {
      console.log('\n📲 Scannez ce QR Code avec WhatsApp (Appareils connectés > Connecter un appareil) :\n');
      qrcode.generate(qr, { small: true });
    }

    // Gestion de la fermeture ou ouverture
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Connexion fermée (statut: ${statusCode}). Reconnexion : ${shouldReconnect}`);

      if (shouldReconnect) {
        startWhatsAppBot();
      } else {
        console.log('❌ Déconnecté définitivement. Supprimez "auth_info_baileys" et relancez.');
      }
    } else if (connection === 'open') {
      console.log('\n==================================================');
      console.log('✅ Connecté avec succès à WhatsApp !');
      console.log(`🧠 Mode IA automatique : ${aiAutoReplyEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`);
      console.log('📡 Le bot écoute vos commandes et messages entrants...');
      console.log('==================================================\n');
    }
  });

  // Gestion des messages entrants
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

      const remoteJid = msg.key.remoteJid;
      const isFromMe = msg.key.fromMe;
      const isGroup = remoteJid.endsWith('@g.us');
      const sender = msg.pushName || (isFromMe ? 'Moi' : remoteJid.split('@')[0]);

      // Détection des messages vocaux / audios
      const audioMessage = msg.message.audioMessage;
      if (audioMessage) {
        console.log(`🎙️ [${sender}${isGroup ? ' @ Groupe' : ''}] Message vocal (${audioMessage.seconds || 0}s)`);

        if (!isFromMe && aiAutoReplyEnabled && !isGroup) {
          try {
            await sock.sendPresenceUpdate('recording', remoteJid);
            const audioBuffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              { logger, reuploadRequest: sock.updateMediaMessage }
            );

            const aiAnswer = await askAsHumanWithAudio(
              audioBuffer,
              audioMessage.mimetype,
              remoteJid,
              sender
            );

            if (aiAnswer) {
              await sock.sendMessage(remoteJid, { text: aiAnswer }, { quoted: msg });
            }
          } catch (err) {
            console.error('Erreur traitement audio entrant :', err.message);
          }
        }
        continue;
      }

      // Récupération du texte
      const rawText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        '';

      const text = rawText.trim();

      if (text) {
        console.log(`📩 [${sender}${isGroup ? ' @ Groupe' : ''}] : ${text}`);
      }

      // ==========================================
      // GESTION DES COMMANDES (préfixe !)
      // ==========================================
      if (text.startsWith('!')) {
        const [rawCmd, ...rest] = text.slice(1).split(' ');
        const command = rawCmd.toLowerCase();
        const argsStr = rest.join(' ').trim();

        switch (command) {
          // --- Commandes basiques ---
          case 'ping':
            await sock.sendMessage(remoteJid, { text: '🏓 Pong ! Bot opérationnel.' }, { quoted: msg });
            break;

          case 'heure': {
            const now = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });
            await sock.sendMessage(remoteJid, { text: `🕒 Il est actuellement *${now}* (heure de Paris).` }, { quoted: msg });
            break;
          }

          case 'echo':
            if (!argsStr) {
              await sock.sendMessage(remoteJid, { text: '⚠️ Précisez le texte à répéter : `!echo <texte>`' }, { quoted: msg });
            } else {
              await sock.sendMessage(remoteJid, { text: argsStr }, { quoted: msg });
            }
            break;

          case 'info': {
            const infoText = 
`ℹ️ *Informations sur le chat* :
• Expéditeur : *${sender}*
• Identifiant JID : \`${remoteJid}\`
• Type : ${isGroup ? '👥 Groupe' : '👤 Privé'}
• Date : ${new Date().toLocaleString('fr-FR')}`;
            await sock.sendMessage(remoteJid, { text: infoText }, { quoted: msg });
            break;
          }

          // --- Commandes IA / LLM ---
          case 'ai':
          case 'ia': {
            if (!argsStr) {
              await sock.sendMessage(remoteJid, { text: '⚠️ Posez votre question : `!ai <votre question>`' }, { quoted: msg });
              break;
            }
            await sock.sendPresenceUpdate('composing', remoteJid);
            const aiAnswer = await askAI(argsStr, sender);
            await sock.sendMessage(remoteJid, { text: `🤖 *IA* :\n\n${aiAnswer}` }, { quoted: msg });
            break;
          }

          case 'aimode': {
            if (argsStr === 'on') {
              aiAutoReplyEnabled = true;
              await sock.sendMessage(remoteJid, { text: '✅ Mode IA automatique activé pour les messages privés.' }, { quoted: msg });
            } else if (argsStr === 'off') {
              aiAutoReplyEnabled = false;
              await sock.sendMessage(remoteJid, { text: '🛑 Mode IA automatique désactivé.' }, { quoted: msg });
            } else {
              await sock.sendMessage(remoteJid, {
                text: `ℹ️ État actuel du mode IA : *${aiAutoReplyEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'}*.\nUtilisez \`!aimode on\` ou \`!aimode off\`.`
              }, { quoted: msg });
            }
            break;
          }

          // --- Transcription Audio ---
          case 'transcrire':
          case 'transcription':
          case 'audio': {
            const quotedAudio =
              msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
            if (!quotedAudio) {
              await sock.sendMessage(
                remoteJid,
                { text: '⚠️ Pour transcrire un message vocal, répondez au vocal en écrivant `!transcrire`' },
                { quoted: msg }
              );
              break;
            }

            await sock.sendMessage(remoteJid, { text: '⏳ Écoute et transcription de l\'audio en cours...' }, { quoted: msg });
            try {
              const quotedMsg = {
                key: {
                  remoteJid,
                  id: msg.message.extendedTextMessage.contextInfo.stanzaId
                },
                message: { audioMessage: quotedAudio }
              };
              const audioBuffer = await downloadMediaMessage(
                quotedMsg,
                'buffer',
                {},
                { logger, reuploadRequest: sock.updateMediaMessage }
              );
              const textTranscribed = await transcribeAudio(audioBuffer, quotedAudio.mimetype);
              await sock.sendMessage(
                remoteJid,
                { text: `📝 *Transcription du vocal* :\n\n"${textTranscribed || 'Audio incompréhensible ou silencieux.'}"` },
                { quoted: msg }
              );
            } catch (err) {
              console.error('Erreur transcription audio :', err.message);
              await sock.sendMessage(remoteJid, { text: '⚠️ Échec de la lecture ou transcription de cet audio.' }, { quoted: msg });
            }
            break;
          }

          // --- Alertes et Rappels ---
          case 'rappel': {
            // Format : !rappel <durée: 10s|5m|2h|1d> <message>
            const parts = argsStr.split(' ');
            const duration = parts[0];
            const reminderMsg = parts.slice(1).join(' ').trim();

            if (!duration || !reminderMsg) {
              await sock.sendMessage(remoteJid, {
                text: '⚠️ Syntaxe : `!rappel <durée> <message>`\nExemples :\n• `!rappel 10s Boire de l\'eau`\n• `!rappel 30m Sortir le plat`\n• `!rappel 2h Rendez-vous docteur`'
              }, { quoted: msg });
              break;
            }

            const res = scheduler.addOneTimeReminder(remoteJid, duration, reminderMsg);
            if (!res) {
              await sock.sendMessage(remoteJid, { text: '⚠️ Format de durée invalide. Utilisez s (secondes), m (minutes), h (heures), d (jours).' }, { quoted: msg });
            } else {
              const due = new Date(res.dueTime).toLocaleTimeString('fr-FR');
              await sock.sendMessage(remoteJid, {
                text: `⏰ Rappel enregistré avec succès (ID: \`${res.id}\`) !\nIl sera envoyé à *${due}*.`
              }, { quoted: msg });
            }
            break;
          }

          case 'alerte': {
            // Format : !alerte <HH:MM> <message>
            const parts = argsStr.split(' ');
            const timeHHMM = parts[0];
            const alertMsg = parts.slice(1).join(' ').trim();

            if (!timeHHMM || !alertMsg) {
              await sock.sendMessage(remoteJid, {
                text: '⚠️ Syntaxe : `!alerte <HH:MM> <message>`\nExemple : `!alerte 09:00 Bonjour, début de la journée !`'
              }, { quoted: msg });
              break;
            }

            const res = scheduler.addDailyAlert(remoteJid, timeHHMM, alertMsg);
            if (!res) {
              await sock.sendMessage(remoteJid, { text: '⚠️ Format d\'heure invalide. Utilisez le format HH:MM (ex: 08:30 ou 19:00).' }, { quoted: msg });
            } else {
              await sock.sendMessage(remoteJid, {
                text: `🔔 Alerte quotidienne programmée pour *${timeHHMM}* chaque jour (ID: \`${res.id}\`).`
              }, { quoted: msg });
            }
            break;
          }

          case 'listrappels': {
            const list = scheduler.listReminders(remoteJid);
            if (list.length === 0) {
              await sock.sendMessage(remoteJid, { text: '📭 Aucun rappel ou alerte en attente pour cette discussion.' }, { quoted: msg });
            } else {
              const lines = list.map((r) => {
                if (r.type === 'once') {
                  const at = new Date(r.dueTime).toLocaleString('fr-FR');
                  return `• [ID: \`${r.id}\`] ⏰ Unique prévu à *${at}* : ${r.message}`;
                } else {
                  return `• [ID: \`${r.id}\`] 🔔 Récurrent à *${r.timeStr}* : ${r.message}`;
                }
              });
              await sock.sendMessage(remoteJid, { text: `📋 *Rappels actifs* :\n${lines.join('\n')}` }, { quoted: msg });
            }
            break;
          }

          case 'delrappel': {
            if (!argsStr) {
              await sock.sendMessage(remoteJid, { text: '⚠️ Précisez l\'ID du rappel : `!delrappel <id>`' }, { quoted: msg });
            } else {
              scheduler.cancelReminder(argsStr.trim());
              await sock.sendMessage(remoteJid, { text: `🗑️ Rappel \`${argsStr}\` supprimé s'il existait.` }, { quoted: msg });
            }
            break;
          }

          // --- Réponses automatiques personnalisées ---
          case 'addreply': {
            // Syntaxe : !addreply mot_clé | réponse
            const [trigger, ...replyParts] = argsStr.split('|');
            const customReply = replyParts.join('|').trim();

            if (!trigger || !customReply) {
              await sock.sendMessage(remoteJid, {
                text: '⚠️ Syntaxe : `!addreply <mot_clé> | <texte de réponse>`\nExemple : `!addreply tarif | Notre tarif est de 20€/mois.`'
              }, { quoted: msg });
              break;
            }

            autoReplies.addRule(trigger.trim(), customReply);
            await sock.sendMessage(remoteJid, {
              text: `✅ Réponse automatique enregistrée pour le mot-clé : *"${trigger.trim()}"*`
            }, { quoted: msg });
            break;
          }

          case 'delreply': {
            if (!argsStr) {
              await sock.sendMessage(remoteJid, { text: '⚠️ Précisez le mot-clé à supprimer : `!delreply <mot_clé>`' }, { quoted: msg });
            } else {
              const ok = autoReplies.removeRule(argsStr.trim());
              await sock.sendMessage(remoteJid, {
                text: ok ? `🗑️ Règle supprimée pour *"${argsStr}"*.` : `⚠️ Aucune règle trouvée pour *"${argsStr}"*.`
              }, { quoted: msg });
            }
            break;
          }

          case 'listreplies': {
            const rules = autoReplies.listRules();
            if (rules.length === 0) {
              await sock.sendMessage(remoteJid, { text: '📭 Aucune règle automatique configurée.' }, { quoted: msg });
            } else {
              const lines = rules.map(r => `• *${r.trigger}* ➜ _${r.reply.substring(0, 50)}${r.reply.length > 50 ? '...' : ''}_`);
              await sock.sendMessage(remoteJid, { text: `📋 *Réponses automatiques actives* :\n${lines.join('\n')}` }, { quoted: msg });
            }
            break;
          }

          // --- Menu d'aide ---
          case 'aide':
          case 'help': {
            const help =
`🤖 *MENU DU BOT WHATSAPP* 🤖

🔹 *Commandes Générales* :
• *!ping* : Test de connectivité
• *!heure* : Heure actuelle
• *!info* : Informations sur le chat
• *!echo <texte>* : Répéter un message

🔹 *Intelligence Artificielle & Audio* :
• *!ai <question>* : Interroger l'IA (Gemini / LLM)
• *!aimode on/off* : Activer les réponses IA auto en privé
• *!transcrire* : Transcrire un vocal (répondez à un vocal avec ce mot)

🔹 *Rappels & Alertes Programmées* :
• *!rappel <durée> <message>* (ex: \`!rappel 10m Sortir le plat\`)
• *!alerte <HH:MM> <message>* (ex: \`!alerte 09:00 Rappel du matin\`)
• *!listrappels* : Voir tous les rappels actifs
• *!delrappel <id>* : Supprimer un rappel

🔹 *Réponses Automatiques Personnalisées* :
• *!addreply <déclencheur> | <réponse>* : Créer une règle
• *!delreply <déclencheur>* : Supprimer une règle
• *!listreplies* : Lister les règles actives`;
            await sock.sendMessage(remoteJid, { text: help }, { quoted: msg });
            break;
          }

          default:
            // Commande inconnue : ne rien faire pour ne pas polluer
            break;
        }
        return; // Ne pas poursuivre vers les réponses automatiques
      }

      // ==========================================
      // RÉPONSES AUTOMATIQUES AUX MESSAGES CLASSIQUES
      // ==========================================
      // On ne répond pas aux messages envoyés par le bot lui-même
      if (isFromMe) return;

      // 1. Vérification des règles prédéfinies (auto-replies)
      const matchedReply = autoReplies.findReply(text);
      if (matchedReply) {
        await sock.sendMessage(remoteJid, { text: matchedReply }, { quoted: msg });
        return;
      }

      // 2. Si le mode IA automatique est activé en discussion privée
      if (aiAutoReplyEnabled && !isGroup && text.length > 1) {
        await sock.sendPresenceUpdate('composing', remoteJid);
        const aiAnswer = await askAsHuman(text, remoteJid, sender);
        await sock.sendMessage(remoteJid, { text: aiAnswer }, { quoted: msg });
      }
    }
  });
}

startWhatsAppBot().catch((err) => {
  console.error('Erreur inattendue au lancement du bot :', err);
});
