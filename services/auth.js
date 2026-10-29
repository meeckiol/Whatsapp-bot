import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

export async function promptAuthMode(envPhoneNumber) {
  // 1. Si PHONE_NUMBER est défini dans .env
  if (envPhoneNumber && envPhoneNumber.trim().length >= 6) {
    const cleaned = envPhoneNumber.trim().replace(/[^0-9]/g, '');
    console.log(`📱 Utilisation du numéro configuré dans .env : ${cleaned}`);
    return { mode: 'pairing', phoneNumber: cleaned };
  }

  // 2. Si passé en argument de ligne de commande
  const args = process.argv.slice(2);
  const phoneIdx = args.indexOf('--phone');
  if (phoneIdx !== -1 && args[phoneIdx + 1]) {
    const cleaned = args[phoneIdx + 1].trim().replace(/[^0-9]/g, '');
    return { mode: 'pairing', phoneNumber: cleaned };
  }
  if (args.includes('--pairing')) {
    const rl = readline.createInterface({ input, output });
    const num = await rl.question('\n📱 Entrez votre numéro de téléphone (avec indicatif pays, ex: 33612345678) : ');
    rl.close();
    return { mode: 'pairing', phoneNumber: num.trim().replace(/[^0-9]/g, '') };
  }
  if (args.includes('--qr')) {
    return { mode: 'qr' };
  }

  // 3. Menu interactif si dans un terminal interactif
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║       📲 MODE DE CONNEXION WHATSAPP               ║');
    console.log('╠════════════════════════════════════════════════════╣');
    console.log('║ 1. Scanner un QR Code (Classique)                  ║');
    console.log('║ 2. Associer avec un numéro (Code d\'association)    ║');
    console.log('╚════════════════════════════════════════════════════╝');

    let timeoutId;
    const choicePromise = rl.question('👉 Votre choix (1 ou 2) [Défaut: 1 dans 20s] : ');
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve('1'), 20000);
    });

    const choice = (await Promise.race([choicePromise, timeoutPromise])).trim();
    clearTimeout(timeoutId);

    if (choice === '2') {
      const num = await rl.question('📱 Entrez votre numéro WhatsApp (indicatif pays sans +, ex: 33612345678) : ');
      rl.close();
      const cleaned = num.trim().replace(/[^0-9]/g, '');
      if (cleaned.length < 6) {
        console.log('⚠️ Numéro invalide. Bascule sur le scan de QR Code.');
        return { mode: 'qr' };
      }
      return { mode: 'pairing', phoneNumber: cleaned };
    }

    rl.close();
    return { mode: 'qr' };
  }

  // Fallback silencieux : QR Code
  return { mode: 'qr' };
}
