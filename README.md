# WhatsApp Bot & Automatisation (Node.js & Baileys)

Bot WhatsApp complet avec support :
1. **Deux modes de connexion** : Scan de **QR Code** ou **Code d'association par numéro de téléphone** (comme sur WhatsApp Web).
2. **Réponses automatiques personnalisées** configurables via JSON ou commandes de discussion.
3. **Intégration d'un LLM / IA** (Google Gemini ou Ollama en local).
4. **Alertes et rappels programmés** (minuteries ponctuelles et alertes quotidiennes).

---

## 🚀 Installation & Démarrage

### Mode interactif (au premier plan)
```bash
cd /home/phantomphreak/whatsapp-bot
npm start
```

### Mode Arrière-plan permanent (PM2)
Pour que le bot tourne **24h/24 en tâche de fond**, même si vous fermez le terminal ou faites `Ctrl+C` :
```bash
cd /home/phantomphreak/whatsapp-bot

# Démarrer en arrière-plan
npm run bot:start

# Voir les messages et logs en direct
npm run bot:logs

# Voir le statut du bot
npm run bot:status

# Arrêter le bot
npm run bot:stop

# Redémarrer le bot
npm run bot:restart
```

---

## 📱 Deux méthodes de connexion au choix

Au premier lancement (quand aucune session n'est encore enregistrée), vous avez deux options :

### Méthode 1 : Code d'association par numéro (Recommandé si vous n'avez pas de caméra ou préférez le code)
1. Lancez le bot :
   ```bash
   npm start
   ```
   ou directement avec votre numéro (format international sans le `+`, ex: `33612345678` pour la France) :
   ```bash
   npm run start:phone -- 33612345678
   # ou
   node index.js --phone 33612345678
   ```
2. Un code à 8 caractères s'affiche dans votre terminal (ex: `ABCD-1234`).
3. Sur votre smartphone :
   - Ouvrez **WhatsApp**.
   - Allez dans **Réglages** (iOS) ou **Menu ⁝** (Android) > **Appareils connectés** > **Connecter un appareil**.
   - En bas sous le viseur de la caméra, touchez **"Associer avec un numéro de téléphone"**.
   - Saisissez le code affiché dans le terminal.
4. C'est connecté ! La session est sauvegardée dans `auth_info_baileys/`.

### Méthode 2 : Scanner le QR Code
1. Lancez le bot en mode QR :
   ```bash
   node index.js --qr
   ```
2. Scannez le QR Code affiché dans le terminal avec l'appareil photo WhatsApp.

---

## 🧠 Configuration de l'Intelligence Artificielle (Optionnel)

Pour activer le modèle de langage (ex: Google Gemini) :
1. Éditez le fichier `.env` :
   ```ini
   GEMINI_API_KEY=votre_cle_api_gemini
   GEMINI_MODEL=gemini-2.5-flash
   AI_AUTO_REPLY=false
   ```
   *(Obtenez une clé gratuitement sur [Google AI Studio](https://aistudio.google.com/))*
2. Vous pouvez aussi utiliser un LLM local **Ollama** en renseignant `OLLAMA_HOST` et `OLLAMA_MODEL`.

---

## 💬 Liste des Commandes WhatsApp

Envoyez ces commandes depuis WhatsApp (en discussion privée avec le bot, dans un groupe ou depuis votre propre discussion) :

### 🔹 Général
- `!aide` : Affiche l'ensemble des commandes disponibles.
- `!ping` : Vérifie que le bot répond (`Pong ! 🏓`).
- `!heure` : Affiche l'heure exacte.
- `!info` : Donne des informations sur le chat (ID, expéditeur, type).
- `!echo <texte>` : Répète le texte.

### 🔹 Intelligence Artificielle
- `!ai <votre question>` : Pose une question au modèle de langage.
- `!aimode on` : Active la réponse automatique de l'IA à tous les messages privés entrants.
- `!aimode off` : Désactive le mode IA automatique.

### 🔹 Alertes et Rappels Programmés
- `!rappel <durée> <message>` : Programme un rappel ponctuel.
  - Exemples :
    - `!rappel 30s Sortir les pâtes de l'eau`
    - `!rappel 15m Vérifier les emails`
    - `!rappel 2h Rendez-vous client`
    - `!rappel 1d Préparer les bagages`
- `!alerte <HH:MM> <message>` : Programme une alerte récurrente quotidienne.
  - Exemple : `!alerte 09:00 Bonjour, voici le début de journée !`
- `!listrappels` : Affiche la liste des rappels actifs.
- `!delrappel <id>` : Supprime un rappel en cours.

### 🔹 Réponses Automatiques Personnalisées
- `!addreply <mot_clé> | <réponse>` : Ajoute une réponse automatique déclenchée par un mot-clé.
  - Exemple : `!addreply horaires | Nous sommes ouverts du lundi au vendredi de 9h à 18h.`
- `!delreply <mot_clé>` : Supprime une réponse automatique.
- `!listreplies` : Liste toutes les règles actives.
*(Toutes les règles sont stockées et modifiables dans `data/auto_replies.json`).*

---

## 📁 Structure du Projet

```
whatsapp-bot/
├── index.js              # Entrée principale & gestionnaire d'événements Baileys
├── package.json          # Scripts et dépendances
├── .env                  # Clés API et configuration
├── services/
│   ├── auth.js           # Gestion du Pairing Code & QR Code
│   ├── ai.js             # Client LLM (Gemini / Ollama)
│   ├── replies.js        # Gestionnaire de réponses automatiques
│   └── scheduler.js      # Planificateur de rappels et cron
└── data/
    ├── auto_replies.json # Stockage persistant des règles de réponse
    └── reminders.json    # Stockage persistant des rappels programmés
```
