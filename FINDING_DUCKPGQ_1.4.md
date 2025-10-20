# Finding DuckPGQ for DuckDB 1.4.x

Guide pour trouver et configurer une version de DuckPGQ compatible avec DuckDB 1.4.x.

## 🔍 Où chercher

### Option 1: Releases GitHub (Recommandé)

**URL**: https://github.com/cwida/duckpgq-extension/releases

**Étapes**:

1. Allez sur la page des releases
2. Cherchez une release mentionnant DuckDB 1.4.x ou v1.4 dans le titre/notes
3. Téléchargez le fichier correspondant à votre plateforme :
   - Linux: `duckpgq-v*-linux-amd64.duckdb_extension.gz`
   - macOS Intel: `duckpgq-v*-osx-amd64.duckdb_extension.gz`
   - macOS ARM: `duckpgq-v*-osx-arm64.duckdb_extension.gz`
   - Windows: `duckpgq-v*-windows-amd64.duckdb_extension.gz`

4. Utilisez l'URL de téléchargement direct dans `DUCKPGQ_CUSTOM_REPO`

**Format d'URL typique**:

```
https://github.com/cwida/duckpgq-extension/releases/download/v0.x.y/duckpgq-v0.x.y-linux-amd64.duckdb_extension.gz
```

### Option 2: GitHub Actions Artifacts

**URL**: https://github.com/cwida/duckpgq-extension/actions

**Étapes**:

1. Allez dans l'onglet "Actions"
2. Cherchez des workflows récents qui ont réussi (✅)
3. Cliquez sur un workflow build récent
4. Descendez à "Artifacts" en bas de page
5. Téléchargez l'artifact pour votre plateforme
6. Extrayez le fichier `.duckdb_extension.gz`

**Note**: Les artifacts GitHub expirent après 90 jours et nécessitent d'être connecté.

### Option 3: DuckDB Community Repository (Futur)

**Status**: Pas encore disponible pour DuckDB 1.4.x

Quand disponible, simplement utiliser:

```bash
DUCKPGQ_SOURCE=community
```

## 🛠️ Configuration

### Plateforme actuelle

Détectez votre plateforme:

```bash
uname -sm
# Linux x86_64 → linux-amd64
# Darwin x86_64 → osx-amd64
# Darwin arm64 → osx-arm64
```

Votre système actuel:

```bash
$ uname -sm
Linux x86_64
```

→ Vous avez besoin de: `linux-amd64`

### Configurer l'URL

Une fois que vous avez trouvé l'URL du fichier `.duckdb_extension.gz`:

**Méthode 1: Via .env**

```bash
DUCKPGQ_CUSTOM_REPO=https://github.com/cwida/duckpgq-extension/releases/download/vX.Y.Z/duckpgq-vX.Y.Z-linux-amd64.duckdb_extension.gz
```

**Méthode 2: Via variable d'environnement**

```bash
export DUCKPGQ_CUSTOM_REPO="https://..."
npm run test:duckpgq
```

## 🧪 Tester l'installation

### Test rapide

```bash
npm run test:duckpgq
```

### Test avec exemples

```bash
tsx examples/duckpgq-graph-example.ts
```

## 📋 URLs à essayer

Voici quelques patterns d'URL à tester (remplacez VERSION et DATE selon les releases disponibles):

```bash
# Pattern général (vérifier les releases pour trouver la bonne version)
https://github.com/cwida/duckpgq-extension/releases/download/v0.x.y/duckpgq-v0.x.y-linux-amd64.duckdb_extension.gz

# Exemples (versions hypothétiques, vérifier la réalité):
# https://github.com/cwida/duckpgq-extension/releases/download/v0.1.0/duckpgq-v0.1.0-linux-amd64.duckdb_extension.gz
# https://github.com/cwida/duckpgq-extension/releases/download/v0.2.0/duckpgq-v0.2.0-linux-amd64.duckdb_extension.gz
```

## 🔧 Script de test rapide

Utilisez le script fourni pour tester plusieurs URLs:

```bash
./scripts/find-duckpgq-url.sh
```

## 🐛 Troubleshooting

### Erreur: "HTTP 404"

→ L'URL n'existe pas ou la version n'est pas disponible
→ Vérifiez manuellement sur GitHub

### Erreur: "Platform mismatch"

→ Le fichier téléchargé ne correspond pas à votre plateforme
→ Vérifiez que vous utilisez le bon suffixe (linux-amd64, osx-arm64, etc.)

### Erreur: "Version mismatch"

→ L'extension DuckPGQ n'est pas compatible avec DuckDB 1.4.1
→ Essayez une autre version ou attendez une release compatible

### Extension se charge mais requêtes échouent

→ Possible incompatibilité partielle
→ Vérifiez les logs pour plus de détails
→ Reportez le problème sur GitHub

## 📞 Ressources

- **DuckPGQ Repository**: https://github.com/cwida/duckpgq-extension
- **Issue #276**: https://github.com/cwida/duckpgq-extension/issues/276
- **DuckDB Extensions**: https://duckdb.org/docs/extensions/overview
- **Community Extensions**: https://community-extensions.duckdb.org/

## 💡 Stratégie recommandée

Pour le moment (2025-10-20):

**Développement**:

1. Chercher une release compatible sur GitHub
2. Tester avec `DUCKPGQ_SOURCE=custom`
3. Valider avec les exemples fournis

**Production**:

1. Garder `DUCKPGQ_SOURCE=community`
2. Laisser le graceful fallback actif
3. Monitorer les releases pour migration future

---

_Dernière mise à jour: 2025-10-20_
