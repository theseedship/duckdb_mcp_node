# Plan de Robustification - duckdb_mcp_node

**Date Début**: 2025-10-19
**Objectif**: Fixer 15 tests + 156 warnings ESLint + Supprimer continue-on-error
**Status**: 🚧 En cours

## 🎯 Objectifs

1. ✅ Tous les tests passent (0/15 actuellement)
2. ✅ Tous les ESLint warnings résolus (0/156 actuellement)
3. ✅ Workflow CI robuste (supprimer `continue-on-error`)
4. ✅ Code production-ready

## 📊 État Actuel (Baseline)

### Tests Échouants: 15

#### 1. MetricsCollector.test.ts (1 test)

- **Erreur**: `ENOENT: no such file or directory, scandir '/path/to/logs/metrics'`
- **Ligne**: ~463
- **Cause**: Directory `/logs/metrics` n'existe pas dans l'environnement de test
- **Priorité**: 🟢 Faible - Simple à fixer
- **Estimation**: 10 minutes

**Fix prévu**:

```typescript
// Dans le test: créer le directory avant le test
beforeEach(async () => {
  await fs.promises.mkdir('logs/metrics', { recursive: true })
})
```

#### 2. VirtualFilesystem.test.ts (11 tests)

**Méthodes manquantes**:

- `resolveMultiple()` - 2 tests
- `getStats()` - 3 tests

**Autres problèmes**:

- Resource resolution errors - 3 tests
- Assertion failures - 1 test
- Spy call count mismatches - 2 tests

**Priorité**: 🔴 Haute - Beaucoup de tests
**Estimation**: 2-3 heures

**Fixes prévus**:

1. Ajouter méthode `resolveMultiple()` dans `src/filesystem/VirtualFilesystem.ts`
2. Ajouter méthode `getStats()` dans `src/filesystem/VirtualFilesystem.ts`
3. Fixer la logique de resolution
4. Ajuster les assertions

#### 3. transports.test.ts (4 tests)

**Méthodes manquantes**:

- `adapter.connect()` - 2 tests
- `adapter.on()` - 2 tests

**Priorité**: 🟡 Moyenne - Interface mismatch
**Estimation**: 1 heure

**Fix prévu**:

- Mettre à jour les transport adapters pour implémenter `connect()` et `on()`
- OU adapter les tests pour matcher l'interface actuelle

### ESLint Warnings: 156

#### Par Type:

1. **@typescript-eslint/no-explicit-any**: ~140 warnings
   - Remplacer `any` par types précis
   - Utiliser `unknown` si nécessaire
   - Créer des types custom quand approprié

2. **@typescript-eslint/no-non-null-assertion**: ~16 warnings
   - Remplacer `!` par type guards
   - Utiliser optional chaining `?.`
   - Ajouter checks nullish

#### Par Fichier (Top 10):

1. MCPClient.ts - ~10 warnings
2. ResourceMapper.ts - ~9 warnings
3. SpaceContext.ts - ~18 warnings
4. duckdb/service.ts - ~15 warnings
5. mcp-server.ts - ~9 warnings
6. VirtualFilesystem.ts - ~3 warnings
7. (autres fichiers) - ~90 warnings

**Priorité**: 🟡 Moyenne - Améliore la qualité du code
**Estimation**: 3-4 heures

## 📅 Plan d'Exécution

### Phase 1: Fixes Rapides (30 min)

- [x] Créer ce plan de robustification
- [ ] Fixer MetricsCollector test (1 test - 10 min)
- [ ] Run tests pour valider le fix (+5 min)
- [ ] Commit: `fix(tests): create logs/metrics directory in MetricsCollector tests`

### Phase 2: VirtualFilesystem (3h)

- [ ] Analyser les méthodes manquantes (30 min)
- [ ] Implémenter `resolveMultiple()` (45 min)
- [ ] Implémenter `getStats()` (45 min)
- [ ] Fixer les autres problèmes (1h)
- [ ] Run tests pour validation
- [ ] Commit: `fix(filesystem): add resolveMultiple and getStats methods to VirtualFilesystem`

### Phase 3: Transport Adapters (1h)

- [ ] Analyser l'interface attendue (15 min)
- [ ] Implémenter `connect()` et `on()` (30 min)
- [ ] OU adapter les tests (30 min)
- [ ] Run tests pour validation
- [ ] Commit: `fix(protocol): implement connect and on methods in transport adapters`

### Phase 4: ESLint Warnings (4h)

#### Batch 1: High-Impact Files (2h)

- [ ] SpaceContext.ts (18 warnings - 30 min)
- [ ] duckdb/service.ts (15 warnings - 30 min)
- [ ] MCPClient.ts (10 warnings - 20 min)
- [ ] ResourceMapper.ts (9 warnings - 20 min)
- [ ] mcp-server.ts (9 warnings - 20 min)
- [ ] Run lint pour validation
- [ ] Commit: `fix(lint): resolve ESLint warnings in core files`

#### Batch 2: Remaining Files (2h)

- [ ] Tous les autres fichiers (~90 warnings - 2h)
- [ ] Run lint pour validation
- [ ] Commit: `fix(lint): resolve all remaining ESLint warnings`

### Phase 5: Workflow Cleanup (15 min)

- [ ] Supprimer `continue-on-error: true` de `.github/workflows/release.yml`
- [ ] Run workflow de test sur GitHub
- [ ] Commit: `fix(ci): remove continue-on-error from release workflow`

### Phase 6: Validation Finale (30 min)

- [ ] Run tous les tests localement
- [ ] Run tous les lints
- [ ] Run build
- [ ] Trigger release workflow sur GitHub
- [ ] Vérifier que tout passe ✅

## 🎯 Checklist Finale

### Tests

- [ ] 0 tests échouants
- [ ] Coverage ≥ 7% (threshold actuel)
- [ ] Tous les test suites passent

### Code Quality

- [ ] 0 ESLint errors
- [ ] 0 ESLint warnings
- [ ] TypeScript compile sans erreurs
- [ ] Prettier appliqué partout

### CI/CD

- [ ] Workflow release passe sans `continue-on-error`
- [ ] Tous les checks GitHub passent
- [ ] Ready pour publish npm

## 📈 Métriques de Progrès

### Tests

- Tests passants: 0/15 → target: 15/15
- Taux de succès: 0% → target: 100%

### ESLint

- Warnings: 156 → target: 0
- Réduction: 0% → target: 100%

### Temps Estimé Total

- Tests: 4.5h
- ESLint: 4h
- Workflow: 0.5h
- Validation: 0.5h
- **TOTAL**: ~9-10 heures de travail

## 🚀 Let's Go!

**Next Step**: Phase 1 - Fixer MetricsCollector test (10 min)

---

**Créé**: 2025-10-19
**Dernière MAJ**: 2025-10-19
**Temps écoulé**: 0h
**Temps restant estimé**: 9-10h
