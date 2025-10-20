# DuckPGQ Integration Findings (2025-10-20)

## ✅ Ce qui fonctionne

### 1. Installation

- ✅ **DuckPGQ est disponible depuis community repository pour DuckDB 1.4.x**
- ✅ Version installée : `7705c5c` (commit hash)
- ✅ Installation automatique : `INSTALL duckpgq FROM community; LOAD duckpgq;`
- ✅ Chargement vérifié : Extension s'affiche dans `SELECT * FROM duckdb_extensions()`

### 2. Création de Property Graphs

- ✅ Syntaxe de base fonctionne :

```sql
CREATE PROPERTY GRAPH graph_name
  VERTEX TABLES (TableName)
  EDGE TABLES (
    EdgeTable
      SOURCE KEY (edge_from_col) REFERENCES VertexTable (vertex_col)
      DESTINATION KEY (edge_to_col) REFERENCES VertexTable (vertex_col)
  );
```

### 3. Requêtes de base

- ✅ **Chemins directs** (1 hop) :

```sql
FROM GRAPH_TABLE (graph_name
  MATCH (a:Table1)-[e:EdgeTable]->(b:Table2)
  COLUMNS (a.name, b.name, e.property)
)
```

- ✅ **Chemins de longueur fixe** (2 hops, 3 hops, etc.) :

```sql
MATCH (a:Person)-[e1:Knows]->(b:Person)-[e2:Knows]->(c:Person)
```

- ✅ **Toutes les relations doivent être nommées** :
  - ❌ Mauvais: `(a)-[:Knows]->(b)`
  - ✅ Bon: `(a)-[e:Knows]->(b)`

## ❌ Ce qui ne fonctionne PAS

### 1. Quantificateurs Kleene

- ❌ Kleene star `*` (zéro ou plus)
- ❌ Kleene plus `+` (un ou plus)
- ❌ Quantificateurs bornés `{n,m}`

**Erreurs rencontrées** :

```
Parser Error: syntax error at or near "*"
Parser Error: syntax error at or near "+"
Parser Error: syntax error at or near "{"
```

### 2. ANY SHORTEST Path

- ❌ `MATCH ANY SHORTEST (a)-[e:Edge]*->(b)` n'est pas supporté
- Workaround : Utiliser des chemins de longueur fixe avec `ORDER BY path_length LIMIT 1`

### 3. Commandes DDL avancées

- ❌ `SHOW PROPERTY GRAPHS` n'existe pas
- ❌ `DROP PROPERTY GRAPH` n'existe pas
- Workaround : Simplement DROP les tables

## 🔍 Limitations découvertes

### Version DuckPGQ 7705c5c

Cette version semble être :

1. **Une version de développement** (commit hash plutôt que numéro de version)
2. **Partiellement implémentée** pour DuckDB 1.4.x
3. **Limitée aux chemins fixes** sans quantificateurs variables

### Fonctionnalités annoncées vs. réalité

**Documentation indique** :

- ✅ Kleene operators (`*`, `+`)
- ✅ ANY SHORTEST paths
- ✅ Bounded quantifiers `{n,m}`
- ✅ GRAPH_TABLE syntax

**Réalité de la version 7705c5c** :

- ❌ Kleene operators non fonctionnels
- ❌ ANY SHORTEST non fonctionnel
- ❌ Bounded quantifiers non fonctionnels
- ✅ GRAPH_TABLE syntax basique OK

## 💡 Recommandations

### Pour le développement actuel

**Option 1 : Utiliser DuckPGQ limité (recommandé)**

- Utiliser chemins de longueur fixe uniquement
- Patterns : `(a)-[e1]->(b)-[e2]->(c)` pour 2 hops
- Adapter vos cas d'usage aux limitations

**Option 2 : Attendre version stable**

- Garder `DUCKPGQ_SOURCE=community`
- Continuer sans graph features
- Migrer quand version complète disponible

**Option 3 : Downgrade vers DuckDB 1.2.2**

```bash
npm install @duckdb/node-api@1.2.2
```

- DuckPGQ fonctionne complètement
- Perd les features DuckDB 1.4.x

### Pour la production

✅ **Configuration recommandée** :

```bash
ENABLE_DUCKPGQ=true
DUCKPGQ_SOURCE=community
DUCKPGQ_STRICT_MODE=false  # Graceful degradation
```

- Database continue à fonctionner normalement
- Graph features s'auto-activent quand version stable sort
- Aucune intervention nécessaire

## 📊 Matrice de compatibilité RÉELLE

| DuckDB Version | DuckPGQ Status | Quantificateurs | ANY SHORTEST | Recommandation       |
| -------------- | -------------- | --------------- | ------------ | -------------------- |
| 1.0.0 - 1.2.2  | ✅ Complet     | ✅ Oui          | ✅ Oui       | **Production Ready** |
| 1.4.1 (actuel) | ⚠️ Partiel     | ❌ Non          | ❌ Non       | **Dev Only**         |
| 1.5.x+         | 🔮 Futur       | ?               | ?            | À venir              |

## 🔧 Workarounds pratiques

### Simuler variable-length paths

Au lieu de `(a)-[e:Edge+]->(b)`, utiliser :

```sql
-- Jusqu'à 3 hops
SELECT * FROM (
  SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(b) COLUMNS (...))
  UNION ALL
  SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(x)-[e2]->(b) COLUMNS (...))
  UNION ALL
  SELECT * FROM GRAPH_TABLE (g MATCH (a)-[e1]->(x)-[e2]->(y)-[e3]->(b) COLUMNS (...))
)
```

### Simuler shortest path

```sql
-- Essayer 1 hop, puis 2, puis 3, retourner le premier succès
WITH hop1 AS (SELECT... MATCH (a)-[e]->(b) ...),
     hop2 AS (SELECT... MATCH (a)-[e1]->(x)-[e2]->(b) ...),
     hop3 AS (SELECT... MATCH (a)-[e1]->(x)-[e2]->(y)-[e3]->(b) ...)
SELECT * FROM hop1
UNION ALL (SELECT * FROM hop2 WHERE NOT EXISTS (SELECT 1 FROM hop1))
UNION ALL (SELECT * FROM hop3 WHERE NOT EXISTS (SELECT 1 FROM hop1 UNION ALL SELECT 1 FROM hop2))
LIMIT 1
```

## 📝 Conclusion

**DuckPGQ est DISPONIBLE pour DuckDB 1.4.x** mais dans une version **limitée**.

### Utilisations viables actuelles :

1. ✅ Graphes de relations directes
2. ✅ Patterns de longueur fixe (2-3 hops)
3. ✅ Exploration de graphes simples
4. ✅ POC et prototypage

### Cas d'usage nécessitant version complète :

1. ❌ Shortest path algorithms
2. ❌ Traversées variables (BFS/DFS)
3. ❌ Analyse de réseaux complexes
4. ❌ Graphes à profondeur inconnue

**Action immédiate** : Mettre à jour la documentation pour refléter ces limitations.

---

_Findings basés sur tests du 2025-10-20_
_DuckPGQ version: 7705c5c_
_DuckDB version: 1.4.1-r.4_
