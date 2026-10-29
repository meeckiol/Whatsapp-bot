import dotenv from 'dotenv';
dotenv.config();

let GoogleGenAI = null;
let aiClient = null;

try {
  const genaiModule = await import('@google/genai');
  GoogleGenAI = genaiModule.GoogleGenAI;
  if (process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  // @google/genai indisponible
}

// Mémoire de conversation par contact (remoteJid -> tableau de messages)
const conversationsHistory = new Map();

const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash'
];

function getOwnerName() {
  return process.env.OWNER_NAME || 'Dariano';
}

function getHumanSystemPrompt() {
  const owner = getOwnerName();
  return (
    process.env.AI_CUSTOM_PERSONA ||
`Tu t'appelles ${owner}. Tu réponds à tes messages personnels sur WhatsApp.

STYLE ET RÈGLES DE CONVERSATION STRICTES :
1. INTERDICTION FORMELLE d'utiliser des expressions comme :
   - "Qu'est-ce tu racontes ?" ou "Qu'est-ce que tu racontes ?"
   - "Tu racontes quoi de beau ?"
   - "Ça dit quoi ?" ou "Quoi de neuf ?"
   - "Comment puis-je t'aider ?" ou tout jargon d'assistant.
2. Ne dis JAMAIS que tu es une intelligence artificielle, une IA, un bot ou un assistant. Tu es une vraie personne (${owner}).
3. Sois sobre, calme, posé et direct :
   - Si la personne dit "Salut", "Cc" ou "Bonjour", réponds simplement et poliment : "Salut ! Ça va ?" ou "Hello, comment tu vas ?".
   - Si la personne te pose une question ou te parle d'un sujet, réponds directement à son message sans ajouter de question superflue à la fin.
   - Ne cherche pas à relancer artificiellement la discussion avec des questions inutiles de remplissage.
4. Si la personne te demande "Tu es qui ?", réponds sobrement : "C'est ${owner} ! Ça va ?".
5. Écris des phrases courtes (1 à 2 phrases maximum), propres, matures et naturelles comme un vrai SMS.
6. Si quelqu'un te demande où tu es ou ce que tu fais et que tu ne sais pas, dis calmement que tu es un peu occupé en ce moment.`
  );
}

/**
 * Filtrer et nettoyer les expressions familières indésirables
 */
function sanitizeReply(text) {
  if (!text) return text;
  let cleaned = text
    .replace(/qu['’]est-ce\s+(que\s+)?tu\s+racontes\s*(\?|!)?/gi, '')
    .replace(/tu\s+racontes\s+quoi(\s+de\s+beau)?\s*(\?|!)?/gi, '')
    .replace(/ça\s+dit\s+quoi\s*(\?|!)?/gi, '')
    .replace(/quoi\s+de\s+neuf\s*(\?|!)?/gi, '')
    .trim();

  // Nettoyage ponctuation résiduelle
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  if (/^[,\s!?.-]+$/.test(cleaned) || !cleaned) {
    cleaned = 'Ça va ?';
  }
  return cleaned;
}

// Fonction de génération avec gestion des modèles de secours (fallback)
async function generateWithFallback(systemInstruction, contents) {
  if (!process.env.GEMINI_API_KEY) return null;

  if (!aiClient && GoogleGenAI) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  if (!aiClient) return null;

  const models = [...new Set(CANDIDATE_MODELS)];
  for (const model of models) {
    try {
      const response = await aiClient.models.generateContent({
        model,
        config: {
          systemInstruction,
          temperature: 0.5 // Température modérée pour éviter les dérives familières
        },
        contents
      });

      if (response && response.text) {
        return response.text.trim();
      }
    } catch (err) {
      console.warn(`Modèle ${model} indisponible (${err.message}). Essai du suivant...`);
    }
  }
  return null;
}

/**
 * Répondre à un message texte privé comme un être humain (au nom de Dariano)
 */
export async function askAsHuman(prompt, remoteJid, senderName = 'Contact') {
  if (!conversationsHistory.has(remoteJid)) {
    conversationsHistory.set(remoteJid, []);
  }
  const history = conversationsHistory.get(remoteJid);

  history.push({ role: 'user', text: prompt });
  if (history.length > 6) history.splice(0, history.length - 6);

  const contents = history.map((item) => ({
    role: item.role,
    parts: [{ text: item.text }]
  }));

  const systemInstruction = getHumanSystemPrompt();
  const rawReply = await generateWithFallback(systemInstruction, contents);

  if (rawReply) {
    const reply = sanitizeReply(rawReply);
    history.push({ role: 'model', text: reply });
    return reply;
  }

  const owner = getOwnerName();
  const lower = prompt.toLowerCase();
  if (lower.includes('qui') || lower.includes('tu es')) {
    return `C'est ${owner} ! Ça va ?`;
  }
  return `Salut ! Ça va ? Je suis un peu pris là, je te réponds tout à l'heure.`;
}

/**
 * Écouter un message vocal audio reçu et y répondre naturellement
 */
export async function askAsHumanWithAudio(audioBuffer, rawMimeType, remoteJid, senderName = 'Contact') {
  if (!conversationsHistory.has(remoteJid)) {
    conversationsHistory.set(remoteJid, []);
  }
  const history = conversationsHistory.get(remoteJid);

  // Nettoyer le mimetype pour Gemini (ex: audio/ogg; codecs=opus -> audio/ogg)
  const mimeType = (rawMimeType || 'audio/ogg').split(';')[0].trim();
  const base64Audio = audioBuffer.toString('base64');

  const historyParts = history.map((item) => ({
    role: item.role,
    parts: [{ text: item.text }]
  }));

  const systemInstruction = getHumanSystemPrompt();

  const userAudioTurn = {
    role: 'user',
    parts: [
      {
        inlineData: {
          mimeType,
          data: base64Audio
        }
      },
      {
        text: `[${senderName} vient de t'envoyer ce message vocal. Écoute ce qu'il/elle dit dans cet audio et réponds-y directement comme Dariano, sur WhatsApp (court, naturel, calme). Ne dis pas "j'ai écouté ton vocal", réponds directement au sujet comme si tu l'avais entendu. Pas de formules du type "qu'est-ce tu racontes".]`
      }
    ]
  };

  const contents = [...historyParts, userAudioTurn];
  const rawReply = await generateWithFallback(systemInstruction, contents);

  if (rawReply) {
    const reply = sanitizeReply(rawReply);
    history.push({ role: 'user', text: `[Message vocal de ${senderName}]` });
    history.push({ role: 'model', text: reply });
    if (history.length > 6) history.splice(0, history.length - 6);
    return reply;
  }

  return `J'ai bien reçu ton vocal ! Je suis un peu dans le bruit là, je te réponds dès que je peux 😉`;
}

/**
 * Transcrire fidèlement un audio en texte
 */
export async function transcribeAudio(audioBuffer, rawMimeType) {
  const mimeType = (rawMimeType || 'audio/ogg').split(';')[0].trim();
  const contents = [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType,
            data: audioBuffer.toString('base64')
          }
        },
        {
          text: 'Transcris exactement ce message audio mot à mot en français (ou dans la langue parlée). Ne donne STRICTEMENT que la transcription du texte prononcé, sans commentaire ni introduction.'
        }
      ]
    }
  ];

  return await generateWithFallback('Tu es un transcripteur audio parfait.', contents);
}

/**
 * Pour la commande explicite !ai <question>
 */
export async function askAI(prompt, senderName = 'Utilisateur') {
  const assistantPrompt = `Tu es un assistant utile, concis et clair. Réponds avec pertinence en utilisant la mise en forme WhatsApp quand nécessaire.`;
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const reply = await generateWithFallback(assistantPrompt, contents);

  if (reply) return reply;

  return `⚠️ Le service IA est temporairement indisponible. Veuillez réessayer dans quelques instants.`;
}
