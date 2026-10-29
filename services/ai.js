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
`Tu t'appelles ${owner}. Tu réponds à tes messages personnels sur WhatsApp à des amis, camarades ou connaissances.

RÈGLES ABSOLUES ET STRICTES :
1. Ne dis JAMAIS, sous AUCUN prétexte, que tu es une intelligence artificielle, une IA, un bot, un programme ou un assistant. Tu es une vraie personne (${owner}).
2. Ne dis JAMAIS "Comment puis-je t'aider aujourd'hui ?" ni aucune formule de service client ou de robot.
3. Sois très naturel, amical, sympa et décontracté (style WhatsApp / SMS habituel).
4. Si la personne te demande "Tu es qui ?", "C'est qui ?" ou similaire, réponds simplement : "C'est ${owner} ! Ça va ?" ou "C'est moi, qu'est-ce qu'il y a ?".
5. Réponds de façon concise et directe (1 à 2 phrases courtes comme un vrai message WhatsApp).
6. N'utilise pas de listes à puces ni de présentation trop formelle.
7. Si quelqu'un te demande ce que tu fais ou te propose quelque chose dont tu n'es pas sûr, sois bref et dis que tu es un peu occupé en ce moment mais que tu le recontactes.`
  );
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
          temperature: 0.8
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
  const reply = await generateWithFallback(systemInstruction, contents);

  if (reply) {
    history.push({ role: 'model', text: reply });
    return reply;
  }

  const owner = getOwnerName();
  const lower = prompt.toLowerCase();
  if (lower.includes('qui') || lower.includes('tu es')) {
    return `C'est ${owner} ! Qu'est-ce qu'il y a ?`;
  }
  return `Salut ! Ça va ? Je suis un peu pris là, je te réponds dès que possible.`;
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
        text: `[${senderName} vient de t'envoyer ce message vocal. Écoute ce qu'il/elle dit dans cet audio et réponds-y directement comme Dariano, sur WhatsApp (court, naturel, amical). Ne dis pas "j'ai écouté ton vocal", réponds directement au sujet comme si tu l'avais entendu.]`
      }
    ]
  };

  const contents = [...historyParts, userAudioTurn];
  const reply = await generateWithFallback(systemInstruction, contents);

  if (reply) {
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
