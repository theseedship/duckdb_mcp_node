# 🧪 Guide de Test des Transports MCP

## 📋 Vue d'ensemble

Ce projet a maintenant **4 types de transports** pour se connecter aux serveurs MCP :

- **stdio** ✅ (fonctionne déjà avec le serveur existant)
- **HTTP** ✅ (nouveau, avec serveur de test)
- **WebSocket** ✅ (nouveau, avec serveur de test)
- **TCP** ✅ (nouveau, avec serveur de test)

## 🚀 Test Rapide - Ce qui Marche Déjà

### Option 1: MCP Inspector (Interface Graphique)

```bash
npm run inspector
```

Ceci ouvre une interface web pour tester le serveur MCP en stdio.

### Option 2: Test stdio Direct

```bash
# Compile d'abord le code
npm run build

# Lance le test stdio (utilise le vrai serveur MCP)
npm run test:stdio
```

## 🆕 Tester les Nouveaux Transports

### 1️⃣ Test HTTP

**Terminal 1 - Démarrer le serveur HTTP:**

```bash
npm run server:http
```

**Terminal 2 - Tester le client HTTP:**

```bash
npm run test:http
```

### 2️⃣ Test WebSocket

**Terminal 1 - Démarrer le serveur WebSocket:**

```bash
npm run server:websocket
```

**Terminal 2 - Tester le client WebSocket:**

```bash
npm run test:websocket
```

### 3️⃣ Test TCP

**Terminal 1 - Démarrer le serveur TCP:**

```bash
npm run server:tcp
```

**Terminal 2 - Tester le client TCP:**

```bash
npm run test:tcp
```

## 📊 Ce que Font les Tests

Chaque test client va :

1. Se connecter au serveur avec le transport spécifique
2. Lister les ressources disponibles
3. Appeler des outils MCP
4. Afficher les résultats
5. Se déconnecter proprement

## 🎯 Comprendre la Différence

### Serveur MCP Réel (stdio seulement)

- **Fichier**: `src/server/mcp-server.ts`
- **Fonction**: Serveur MCP complet avec 14 outils DuckDB
- **Transport**: stdio uniquement
- **Usage**: Production

### Serveurs de Test (HTTP/WebSocket/TCP)

- **Dossier**: `examples/test-servers/`
- **Fonction**: Serveurs mock qui simulent le protocole MCP
- **Transport**: HTTP, WebSocket, ou TCP
- **Usage**: Tests et démonstration

## 🔍 Tester avec des Outils Externes

### Test TCP avec netcat

```bash
# Démarrer le serveur TCP
npm run server:tcp

# Dans un autre terminal, se connecter avec nc
nc localhost 9999

# Envoyer un message JSON-RPC
{"jsonrpc":"2.0","method":"initialize","params":{},"id":"1"}
```

### Test WebSocket avec wscat

```bash
# Installer wscat si nécessaire
npm install -g wscat

# Démarrer le serveur WebSocket
npm run server:websocket

# Se connecter avec wscat
wscat -c ws://localhost:8081

# Envoyer des messages
> {"jsonrpc":"2.0","method":"resources/list","params":{},"id":"1"}
```

### Test HTTP avec curl

```bash
# Démarrer le serveur HTTP
npm run server:http

# Initialiser une session
curl -X POST http://localhost:8080/mcp/initialize \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":"1"}'

# Lister les ressources
curl -X POST http://localhost:8080/mcp/request \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":"2"}'
```

## 🔧 Architecture des Tests

```
┌─────────────────────┐
│   Client de Test    │
│  (MCPClient.ts)     │
└──────────┬──────────┘
           │
    ┌──────▼──────┐
    │  Transport  │
    │  Layer      │
    └──────┬──────┘
           │
    ┌──────▼───────────┬──────────────┬────────────┐
    │ stdio (✅ Prod)  │ HTTP (Mock)  │ WebSocket  │ TCP (Mock)
    │ mcp-server.ts    │ http-server  │ ws-server  │ tcp-server
    └──────────────────┴──────────────┴────────────┘
```

## ❓ FAQ

### Pourquoi le serveur MCP ne supporte que stdio ?

Le serveur principal (`src/server/mcp-server.ts`) utilise actuellement le SDK MCP qui est configuré pour stdio. Les autres transports nécessitent une refonte du serveur.

### Les serveurs de test sont-ils utilisables en production ?

Non, ce sont des mocks pour tester les transports. Ils implémentent le protocole MCP basique mais pas toutes les fonctionnalités DuckDB.

### Comment ajouter les vrais transports au serveur MCP ?

Il faudrait modifier `src/server/mcp-server.ts` pour :

1. Accepter un paramètre de transport
2. Configurer le SDK pour utiliser HTTP/WebSocket/TCP
3. Gérer les connexions multiples

### Quel transport utiliser ?

- **stdio**: Pour les outils CLI locaux
- **HTTP**: Pour les API REST, facile derrière un proxy
- **WebSocket**: Pour le temps réel, notifications push
- **TCP**: Pour la performance maximale en réseau local

## 🎮 Script de Test Interactif

Pour un test guidé de tous les transports :

```bash
chmod +x test-transports.sh
./test-transports.sh
```

## 🐛 Dépannage

### "Connection refused"

→ Vérifiez que le serveur est lancé dans un autre terminal

### "Port already in use"

→ Un serveur tourne déjà sur ce port, arrêtez-le ou changez le port

### "Command not found: tsx"

→ Installez tsx : `npm install -g tsx`

### Les tests échouent après "npm run build"

→ Les fichiers .js cherchent les modules .js compilés dans dist/

---

**Note**: Les transports HTTP, WebSocket et TCP sont maintenant implémentés côté client. Pour une utilisation en production, il faudra adapter le serveur MCP principal pour supporter ces transports.
