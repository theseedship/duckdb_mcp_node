# Roadmap Alignée - État Réel du Projet

## 📊 État Actuel Vérifié (17 septembre 2025)

### ✅ Ce qui est VRAIMENT fonctionnel

#### 1. **Infrastructure de base**

- ✅ Service DuckDB avec toutes les corrections de sécurité
- ✅ Transport stdio uniquement (HTTP/WebSocket sont des stubs)
- ✅ MCP Server avec 14 outils exposés
- ✅ MCP Client avec support attach/detach/resources
- ✅ Système de cache avec TTL 5 minutes
- ✅ Support JSON, CSV, Parquet pour tables virtuelles
- ✅ CI/CD fonctionnel avec GitHub Actions

#### 2. **Outils disponibles dans le serveur MCP** (14 outils)

1. `query_duckdb` - Exécuter des requêtes SQL
2. `list_tables` - Lister les tables
3. `describe_table` - Décrire une table
4. `load_csv` - Charger un fichier CSV
5. `load_parquet` - Charger un fichier Parquet
6. `attach_mcp` - Attacher un serveur MCP externe
7. `detach_mcp` - Détacher un serveur MCP
8. `list_attached_servers` - Lister les serveurs attachés
9. `list_mcp_resources` - Lister les ressources MCP
10. `create_virtual_table` - Créer une table virtuelle
11. `drop_virtual_table` - Supprimer une table virtuelle
12. `list_virtual_tables` - Lister les tables virtuelles
13. `refresh_virtual_table` - Rafraîchir une table virtuelle
14. `query_hybrid` - Requête hybride local/virtuel

#### 3. **Outils de gestion MCP** (9 outils dans duckdb-mcp-tools.ts)

1. `mcpServe` - Démarrer un serveur MCP
2. `mcpAttach` - Attacher un client MCP
3. `mcpDetach` - Détacher un client
4. `mcpCreateVirtualTable` - Créer table virtuelle
5. `mcpCallTool` - Appeler un outil distant
6. `mcpStatus` - Statut des connexions
7. `mcpListResources` - Lister ressources
8. `mcpListTools` - Lister outils
9. `mcpClearCache` - Vider le cache

#### 4. **Tests**

- ✅ 24 tests écrits MAIS:
  - 9 tests passent
  - 15 tests sont skippés (tout DuckDBMcpNativeService.test.ts)
- ❌ Couverture réelle: 7% (pas 90% comme suggéré)

### ❌ Ce qui N'EST PAS implémenté

1. **Transports manquants**
   - ❌ HTTP transport (throw Error)
   - ❌ WebSocket transport (throw Error)
   - ❌ TCP transport (non mentionné)

2. **Features non implémentées**
   - ❌ Virtual filesystem pour URIs mcp://
   - ❌ Connection pooling
   - ❌ Authentication layer
   - ❌ Performance optimizations avancées

3. **Documentation manquante**
   - ❌ TypeDoc non configuré
   - ❌ Guides d'utilisation incomplets
   - ❌ Exemples pratiques limités

## 🎯 Roadmap Corrigée et Priorisée

### Sprint 1: Stabilisation (1 semaine)

#### Priorité CRITIQUE

1. **Activer les 15 tests skippés**
   - Débloquer DuckDBMcpNativeService.test.ts
   - Corriger les tests qui échouent
   - Objectif: 24/24 tests passants

2. **Tests pour composants critiques**
   - MCPClient.ts (attachServer, listResources, readResource)
   - mcp-server.ts (tous les handlers d'outils)
   - ResourceMapper.ts et VirtualTable.ts
   - Objectif: Couverture > 30%

3. **Corriger les problèmes de fermeture**
   - Jest exit clean sans --detectOpenHandles
   - Proper cleanup de toutes les ressources

### Sprint 2: Features Essentielles (1 semaine)

#### Priorité HAUTE

1. **HTTP Transport basique**
   - Implémenter HTTPServerTransport avec Express
   - Implémenter HTTPClientTransport avec fetch
   - Tests de base

2. **Refactoring modulaire**
   - Extraire ResourceHandler de mcp-server.ts
   - Extraire ToolHandler de mcp-server.ts
   - Améliorer séparation des responsabilités

3. **Tests d'intégration**
   - Scénario complet attach → query → detach
   - Tests avec serveur MCP simulé
   - Tests de résilience

### Sprint 3: Production Ready (1 semaine)

#### Priorité MOYENNE

1. **Documentation**
   - Configurer TypeDoc
   - Documenter toutes les APIs publiques
   - Guide quickstart réaliste

2. **WebSocket Transport (optionnel)**
   - Si besoin de real-time identifié
   - Sinon, garder pour v2.0

3. **Package NPM**
   - Préparer pour publication
   - Tests de package installé
   - CI/CD pour auto-publish

## 📋 Actions Immédiates

### Jour 1-2: Tests

```bash
# 1. Activer les tests skippés
- Éditer DuckDBMcpNativeService.test.ts
- Remplacer describe.skip par describe
- Corriger les tests qui échouent

# 2. Créer MCPClient.test.ts
- Test attachServer avec stdio
- Test listResources avec/sans cache
- Test readResource JSON/CSV/Parquet
- Test error handling

# 3. Créer mcp-server.test.ts
- Test tous les 14 handlers d'outils
- Test resource listing
- Test error cases
```

### Jour 3-4: Refactoring

```bash
# 1. Créer server/ResourceHandler.ts
- Extraire logique resources de mcp-server.ts
- Interface claire pour list/read

# 2. Créer server/ToolHandler.ts
- Extraire logique tools de mcp-server.ts
- Validation avec Zod schemas

# 3. Nettoyer mcp-server.ts
- Utiliser les nouveaux handlers
- Simplifier le code principal
```

### Jour 5: Documentation

```bash
# 1. Installer et configurer TypeDoc
npm install --save-dev typedoc

# 2. Créer typedoc.json
- Thème moderne
- Exclude tests et mocks

# 3. Générer documentation
npm run docs:generate

# 4. Mettre à jour README.md
- Statut réel des features
- Roadmap honnête
- Exemples qui fonctionnent
```

## 🚀 Métriques de Succès

### Court terme (1 semaine)

- [ ] 24/24 tests passent (0 skipped)
- [ ] Couverture > 30%
- [ ] README aligné avec réalité
- [ ] CI/CD stable

### Moyen terme (2 semaines)

- [ ] HTTP transport fonctionnel
- [ ] Couverture > 50%
- [ ] Documentation TypeDoc complète
- [ ] Package NPM publiable

### Long terme (1 mois)

- [ ] Production ready
- [ ] Couverture > 70%
- [ ] Adoption par utilisateurs externes
- [ ] Feedback positif communauté

## ⚠️ Risques et Mitigations

1. **Risque**: Tests difficiles à débloquer
   - **Mitigation**: Commencer par tests unitaires simples

2. **Risque**: HTTP transport complexe
   - **Mitigation**: Commencer avec implémentation minimale

3. **Risque**: Breaking changes
   - **Mitigation**: Versioning sémantique strict

## 📝 Notes

- Le README actuel est trop optimiste sur l'état du projet
- La migration C++ → TypeScript (migrate-mcp.md) est ambitieuse mais pas alignée avec le code actuel
- Les issues de sécurité (issues-4.md) ont été corrigées ✅
- Focus sur stabilisation avant nouvelles features
