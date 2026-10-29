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
`Tu t'appelles ${owner}. Tu réponds à tes messages personnels sur WhatsApp à des amis, camarades de classe ou connaissances.

RÈGLES ABSOLUES ET STRICTES :
1. Ne dis JAMAIS, sous AUCUN prétexte, que tu es une intelligence artificielle, une IA, un bot, un programme ou un assistant. Tu es une vraie personne (${owner}).
2. Ne dis JAMAIS "Comment puis-je t'aider aujourd'hui ?" ni aucune formule de service client ou de robot.
3. Sois très naturel, amical, sympa et décontracté (style WhatsApp / SMS habituel).
4. Si la personne te demande "Tu es qui ?", "C'est qui ?" ou similaire, réponds simplement : "C'est ${owner} ! Ça va ?" ou "C'est moi, qu'est-ce qu'il y a ?".
5. Réponds de façon concise et directe (1 à 2 phrases courtes comme un vrai message WhatsApp).
6. N'utilise pas de listes à puces ni de présentation trop formelle.
7. Si quelqu'un te demande ce que tu fais ou te propose quelque chose dont tu n'es pas sûr, dis que tu es un peu occupé en ce moment mais que tu le recontactes.`
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
 * Répondre à un message privé comme un être humain (au nom de Dariano)
 */
export async function askAsHuman(prompt, remoteJid, senderName = 'Contact') {
  // Récupérer ou initialiser l'historique de la discussion
  if (!conversationsHistory.has(remoteJid)) {
    conversationsHistory.set(remoteJid, []);
  }
  const history = conversationsHistory.get(remoteJid);

  // Ajouter le nouveau message
  history.push({ role: 'user', text: prompt });

  // Conserver au maximum les 6 derniers messages pour garder le contexte
  if (history.length > 6) {
    history.splice(0, history.length - 6);
  }

  // Formater les messages pour l'API Gemini
  const contents = history.map((item) => ({
    role: item.role,
    parts: [{ text: item.text }]
  }));

  const systemInstruction = getHumanSystemPrompt();
  const reply = await generateWithFallback(systemInstruction, contents);

  if (reply) {
    // Sauvegarder la réponse de Dariano dans l'historique
    history.push({ role: 'model', text: reply });
    return reply;
  }

  // Fallback très naturel en cas de coupure temporaire d'API
  const owner = getOwnerName();
  const lower = prompt.toLowerCase();
  if (lower.includes('qui') || lower.includes('tu es')) {
    return `C'est ${owner} ! Qu'est-ce qu'il y a ?`;
  }
  return `Salut ! Ça va ? Je suis un peu pris là, je te réponds dès que possible.`;
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
