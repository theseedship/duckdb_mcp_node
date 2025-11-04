# Plan de Tests d'Intégration - v0.10.3

# Corrections P2.9 Composition Robustification

**Package**: `@seed-ship/duckdb-mcp-native@0.10.3`
**Date**: 2025-11-04
**Équipe**: Intégration deposium_MCPs
**Priorité**: HAUTE (Bugs critiques corrigés)

---

## 📋 Résumé des Changements

### Bugs Critiques Corrigés

**Bug #1**: Calcul de médiane incorrect pour tableaux pairs
**Bug #2**: Edges dupliquées après remapping des steps

**Impact**: Amélioration de la qualité des données et précision des workflows composés

**Compatibilité**: ✅ Backwards compatible, aucun changement d'API

---

## 🔧 Mise à Jour du Package

### 1. Mise à jour de la Dépendance

```bash
cd deposium_MCPs
npm install @seed-ship/duckdb-mcp-native@0.10.3
npm install  # Mettre à jour package-lock.json
```

### 2. Vérification de l'Installation

```bash
npm list @seed-ship/duckdb-mcp-native
# Devrait afficher: @seed-ship/duckdb-mcp-native@0.10.3

npm run typecheck  # Vérifier compilation TypeScript
npm test           # Vérifier tests existants
```

### 3. Redémarrage des Services

```bash
# Arrêter les services existants
docker-compose down deposium-mcps

# Rebuild avec nouvelle version
docker-compose build deposium-mcps --no-cache

# Redémarrer
docker-compose up -d deposium-mcps

# Vérifier logs
docker logs deposium-mcps --tail 100 -f
```

---

## 🧪 Série de Tests - Phase 1: Validation Fonctionnelle

### Test 1.1: Vérification de Version

**Objectif**: Confirmer que v0.10.3 est bien chargée

**Procédure**:

```bash
# Dans deposium_MCPs
node -e "console.log(require('@seed-ship/duckdb-mcp-native/package.json').version)"
```

**Résultat Attendu**: `0.10.3`

---

### Test 1.2: Tool process.compose - Cas Basique

**Objectif**: Vérifier que la composition de base fonctionne toujours

**Données de Test**:

```json
{
  "doc_ids": ["doc1", "doc2"],
  "steps_url": "s3://bucket/process_steps.parquet",
  "edges_url": "s3://bucket/process_edges.parquet"
}
```

**Procédure**:

1. Appeler `process.compose` via MCP
2. Vérifier `result.success === true`
3. Vérifier `result.steps.length > 0`
4. Vérifier `result.edges.length > 0`

**Résultat Attendu**:

```json
{
  "success": true,
  "steps": [...],
  "edges": [...],
  "merged_count": N,
  "source_docs": ["doc1", "doc2"],
  "qa": {
    "orphan_steps": [],
    "cycles": [],
    "duplicate_edges": [],
    "warnings": []
  }
}
```

**Critère de Succès**: ✅ Composition réussie sans erreur

---

## 🧪 Série de Tests - Phase 2: Validation Bug #1 (Médiane)

### Test 2.1: Médiane avec 2 Steps Dupliqués (Even-Length)

**Objectif**: Valider que la médiane est correctement calculée pour 2 steps

**Scénario**:

- Processus A: step "Login" avec `order=5`
- Processus B: step "login" avec `order=15` (même step, case variation)
- **Médiane attendue**: `(5 + 15) / 2 = 10`

**Données de Test**:
Créer 2 processus avec:

```sql
-- Process 1
step_id: "step1", step_key: "Login", order: 5

-- Process 2
step_id: "step2", step_key: "login", order: 15
```

**Procédure**:

1. Appeler `process.compose` avec `doc_ids: ["proc1", "proc2"]`
2. Récupérer le step résultant avec `step_key = "login"`
3. Vérifier `result.steps[0].order`

**Résultat Attendu**:

```json
{
  "steps": [
    {
      "step_key": "login",
      "order": 10,  // ✅ Moyenne de 5 et 15
      "label": "Login",
      ...
    }
  ]
}
```

**Critère de Succès**:

- ✅ `order` est exactement `10` (ou très proche, ±0.1)
- ❌ **ANCIEN BUG**: Aurait retourné `15` (upper-middle)

**Priorité**: 🔴 CRITIQUE

---

### Test 2.2: Médiane avec 4 Steps Dupliqués (Even-Length)

**Objectif**: Valider médiane pour 4 steps (cas plus complexe)

**Scénario**:

- 4 processus avec step "Verify" aux orders: `[0, 5, 10, 15]`
- **Médiane attendue**: `(5 + 10) / 2 = 7.5`

**Données de Test**:

```sql
-- 4 processes
step_key: "verify", order: 0
step_key: "Verify", order: 5
step_key: "VERIFY", order: 10
step_key: "verify", order: 15
```

**Procédure**:

1. Composer les 4 processus
2. Vérifier le step "verify" résultant

**Résultat Attendu**:

```json
{
  "steps": [
    {
      "step_key": "verify",
      "order": 7.5,  // ✅ Moyenne de 5 et 10
      ...
    }
  ]
}
```

**Critère de Succès**:

- ✅ `order` est exactement `7.5` (±0.1)
- ❌ **ANCIEN BUG**: Aurait retourné `10`

**Priorité**: 🔴 CRITIQUE

---

### Test 2.3: Médiane avec 3 Steps (Odd-Length - Régression)

**Objectif**: Vérifier que les tableaux impairs fonctionnent toujours

**Scénario**:

- 3 processus avec orders: `[5, 10, 15]`
- **Médiane attendue**: `10` (élément du milieu)

**Données de Test**:

```sql
step_key: "approve", order: 5
step_key: "Approve", order: 10
step_key: "APPROVE", order: 15
```

**Résultat Attendu**:

```json
{
  "steps": [
    {
      "step_key": "approve",
      "order": 10,  // ✅ Élément du milieu
      ...
    }
  ]
}
```

**Critère de Succès**: ✅ `order === 10` (comportement inchangé)

**Priorité**: 🟡 HAUTE (test de régression)

---

## 🧪 Série de Tests - Phase 3: Validation Bug #2 (Edge Deduplication)

### Test 3.1: Détection Edges Dupliquées Après Remapping

**Objectif**: Vérifier que les edges dupliquées sont bien éliminées

**Scénario**:

- Process 1: `[start, Process, end]`, edges: `[start→Process, Process→end]`
- Process 2: `[start, process, end]`, edges: `[start→process, process→end]`
- Après normalization: "Process" et "process" → "process"
- **Avant le fix**: 4 edges (avec doublons)
- **Après le fix**: 2 edges (uniques)

**Données de Test**:

```sql
-- Process 1
steps: [
  {step_id: "s1", step_key: "start", order: 0},
  {step_id: "s2", step_key: "Process", order: 1},
  {step_id: "s3", step_key: "end", order: 2}
]
edges: [
  {from_step_id: "s1", to_step_id: "s2"},
  {from_step_id: "s2", to_step_id: "s3"}
]

-- Process 2
steps: [
  {step_id: "s4", step_key: "start", order: 0},
  {step_id: "s5", step_key: "process", order: 1},
  {step_id: "s6", step_key: "end", order: 2}
]
edges: [
  {from_step_id: "s4", to_step_id: "s5"},
  {from_step_id: "s5", to_step_id: "s6"}
]
```

**Procédure**:

1. Composer les 2 processus
2. Compter les edges résultantes
3. Vérifier qu'il n'y a pas de doublons

**Résultat Attendu**:

```json
{
  "steps": [
    {"step_key": "start", ...},
    {"step_key": "process", ...},  // Merged from "Process" and "process"
    {"step_key": "end", ...}
  ],
  "edges": [
    {"from_step_id": "merged_start", "to_step_id": "merged_process"},  // 1 seule edge
    {"from_step_id": "merged_process", "to_step_id": "merged_end"}     // 1 seule edge
  ]
}
```

**Critère de Succès**:

- ✅ `edges.length === 2` (pas 4)
- ✅ Toutes les edges sont uniques (pas de `from→to` en double)
- ❌ **ANCIEN BUG**: Aurait retourné 4 edges (avec doublons)

**Priorité**: 🔴 CRITIQUE

---

### Test 3.2: Vérification Logs Edge Deduplication

**Objectif**: Confirmer que la déduplication est logguée

**Procédure**:

1. Exécuter Test 3.1
2. Consulter les logs du service
3. Chercher message: `"Removed duplicate edges after remapping"`

**Résultat Attendu**:

```
DEBUG: Removed duplicate edges after remapping {
  before: 4,
  after: 2,
  removed: 2
}
```

**Critère de Succès**: ✅ Log présent avec `removed: 2`

**Priorité**: 🟢 MOYENNE (validation debug)

---

## 🧪 Série de Tests - Phase 4: Tests de Régression

### Test 4.1: QA Checks Toujours Fonctionnels

**Objectif**: Vérifier que les QA checks n'ont pas été cassés

**Scénario**: Workflow avec problèmes connus

**Données de Test**:

```sql
-- Step orphelin (pas d'edges)
steps: [
  {step_id: "s1", step_key: "login"},
  {step_id: "s2", step_key: "orphan"}  -- Pas d'edge
]
edges: []

-- Cycle simple
steps: [
  {step_id: "s3", step_key: "A"},
  {step_id: "s4", step_key: "B"}
]
edges: [
  {from_step_id: "s3", to_step_id: "s4"},
  {from_step_id: "s4", to_step_id: "s3"}  -- Back-edge
]
```

**Résultat Attendu**:

```json
{
  "qa": {
    "orphan_steps": ["orphan"],
    "cycles": [["A", "B"]],
    "duplicate_edges": [],
    "warnings": ["Orphan step detected: orphan", "Cycle detected: A → B → A"]
  }
}
```

**Critère de Succès**: ✅ QA warnings générés correctement

**Priorité**: 🟡 HAUTE

---

### Test 4.2: Performance - Pas de Régression

**Objectif**: Vérifier que les fixes n'ont pas dégradé les performances

**Données de Test**:

- 10 processus avec 20 steps chacun
- Total: 200 steps, ~180 edges

**Procédure**:

1. Mesurer temps d'exécution avant (v0.10.1)
2. Mesurer temps d'exécution après (v0.10.3)
3. Comparer

**Résultat Attendu**:

- Temps v0.10.3 ≤ Temps v0.10.1 × 1.1 (max 10% plus lent)
- Déduplication Set-based est O(n), pas de dégradation attendue

**Critère de Succès**: ✅ Pas de régression performance > 10%

**Priorité**: 🟢 MOYENNE

---

## 🧪 Série de Tests - Phase 5: Cas Limites (Edge Cases)

### Test 5.1: Steps Identiques (Même Order)

**Scénario**: 2 steps avec exactement le même order

**Données de Test**:

```sql
step_key: "login", order: 0
step_key: "Login", order: 0
```

**Résultat Attendu**:

- Médiane: `(0 + 0) / 2 = 0`
- Pas d'erreur

**Critère de Succès**: ✅ Composition réussie, order=0

---

### Test 5.2: Steps avec Orders Très Éloignés (Outliers)

**Scénario**: Orders: `[1, 2, 3, 4, 100]`

**Résultat Attendu**:

- Médiane: `3` (élément du milieu, outlier ignoré)

**Critère de Succès**: ✅ Médiane correcte malgré outlier

---

### Test 5.3: Workflow Vide

**Scénario**: `doc_ids: []` ou processus sans steps

**Résultat Attendu**:

```json
{
  "success": true,
  "steps": [],
  "edges": [],
  "merged_count": 0
}
```

**Critère de Succès**: ✅ Pas d'erreur, résultat vide valide

---

## 📊 Matrice de Tests - Résumé

| Test ID | Catégorie           | Priorité    | Durée Estimée | Blocking |
| ------- | ------------------- | ----------- | ------------- | -------- |
| 1.1     | Version             | 🟢 BASSE    | 1 min         | Non      |
| 1.2     | Fonctionnel         | 🟡 HAUTE    | 5 min         | Oui      |
| 2.1     | Bug #1 (Médiane)    | 🔴 CRITIQUE | 10 min        | Oui      |
| 2.2     | Bug #1 (Médiane)    | 🔴 CRITIQUE | 10 min        | Oui      |
| 2.3     | Bug #1 (Régression) | 🟡 HAUTE    | 5 min         | Oui      |
| 3.1     | Bug #2 (Edges)      | 🔴 CRITIQUE | 15 min        | Oui      |
| 3.2     | Bug #2 (Logs)       | 🟢 MOYENNE  | 3 min         | Non      |
| 4.1     | Régression QA       | 🟡 HAUTE    | 10 min        | Oui      |
| 4.2     | Performance         | 🟢 MOYENNE  | 15 min        | Non      |
| 5.1     | Edge Case           | 🟢 BASSE    | 5 min         | Non      |
| 5.2     | Edge Case           | 🟢 BASSE    | 5 min         | Non      |
| 5.3     | Edge Case           | 🟢 BASSE    | 5 min         | Non      |

**Total Temps Estimé**: ~1h30 (tests bloquants: ~55 min)

---

## ✅ Critères de Validation Globale

### Must-Have (Bloquants pour Production)

- ✅ Tous les tests 🔴 CRITIQUES passent (2.1, 2.2, 3.1)
- ✅ Tests de régression 🟡 HAUTES passent (1.2, 2.3, 4.1)
- ✅ Aucune régression fonctionnelle détectée
- ✅ Services redémarrent correctement

### Nice-to-Have (Non-Bloquants)

- ✅ Tests de performance acceptables
- ✅ Edge cases gérés correctement
- ✅ Logs de debug présents

---

## 🚨 Procédure en Cas d'Échec

### Si Test 2.1 ou 2.2 Échoue (Médiane)

**Impact**: Bug #1 non résolu, calcul médiane incorrect

**Actions**:

1. Vérifier version npm: `npm list @seed-ship/duckdb-mcp-native`
2. Vérifier que v0.10.3 est bien chargée
3. Consulter logs pour erreurs TypeScript
4. Rollback vers v0.10.1 si nécessaire
5. Contacter équipe duckdb_mcp_node

**Rollback**:

```bash
npm install @seed-ship/duckdb-mcp-native@0.10.1
docker-compose restart deposium-mcps
```

---

### Si Test 3.1 Échoue (Edge Deduplication)

**Impact**: Bug #2 non résolu, edges dupliquées

**Actions**:

1. Compter edges résultantes vs attendues
2. Vérifier logs: "Removed duplicate edges"
3. Examiner structure edges retournées
4. Rollback si edges > attendues

---

### Si Tests de Régression Échouent

**Impact**: Fonctionnalité existante cassée

**Actions**:

1. **STOP DEPLOYMENT**
2. Comparer comportement v0.10.1 vs v0.10.3
3. Identifier régression exacte
4. Rollback immédiat
5. Créer issue sur GitHub avec détails

---

## 📝 Rapport de Tests - Template

```markdown
# Rapport de Tests - v0.10.3

Date: YYYY-MM-DD
Testeur: [Nom]
Environnement: [DEV/STAGING/PROD]

## Résultats

### Tests Bloquants

- [ ] Test 1.2: Composition basique - PASS/FAIL
- [ ] Test 2.1: Médiane 2 steps - PASS/FAIL (order attendu: 10, obtenu: \_\_\_)
- [ ] Test 2.2: Médiane 4 steps - PASS/FAIL (order attendu: 7.5, obtenu: \_\_\_)
- [ ] Test 2.3: Médiane 3 steps - PASS/FAIL (order attendu: 10, obtenu: \_\_\_)
- [ ] Test 3.1: Edge deduplication - PASS/FAIL (edges attendues: 2, obtenues: \_\_\_)
- [ ] Test 4.1: QA checks - PASS/FAIL

### Tests Non-Bloquants

- [ ] Test 3.2: Logs deduplication - PASS/FAIL
- [ ] Test 4.2: Performance - PASS/FAIL (temps: \_\_\_ ms)
- [ ] Test 5.1: Orders identiques - PASS/FAIL
- [ ] Test 5.2: Outliers - PASS/FAIL
- [ ] Test 5.3: Workflow vide - PASS/FAIL

## Décision

- [ ] ✅ VALIDÉ pour production (tous tests bloquants OK)
- [ ] ⚠️ VALIDÉ avec réserves (détails: \_\_\_)
- [ ] ❌ REJETÉ (raisons: \_\_\_)

## Notes

[Notes additionnelles, observations, recommandations]
```

---

## 📞 Contacts Support

**Package npm**: `@seed-ship/duckdb-mcp-native`
**GitHub**: https://github.com/theseedship/duckdb_mcp_node
**Issues**: https://github.com/theseedship/duckdb_mcp_node/issues

**Documentation**:

- `PHASE3_VALIDATION_REPORT.md` - Détails techniques des bugs
- `CHANGELOG.md` - Historique des versions
- `README.md` - Guide d'utilisation

---

## 🎯 Checklist Finale

### Avant Tests

- [ ] deposium_MCPs à jour avec v0.10.3
- [ ] Services redémarrés
- [ ] Données de test prêtes
- [ ] Environnement de test propre

### Pendant Tests

- [ ] Logs collectés pour chaque test
- [ ] Résultats documentés en temps réel
- [ ] Screenshots/captures si nécessaire

### Après Tests

- [ ] Rapport rempli et partagé
- [ ] Décision GO/NO-GO documentée
- [ ] Si OK: Déploiement production planifié
- [ ] Si KO: Rollback exécuté, issues créées

---

**Bonne chance pour les tests! 🚀**

_Document préparé par Claude Code - 2025-11-04_
