# Fix GitHub Actions Permission Error

## ❌ Current Error

```
##[error]release-please failed: GitHub Actions is not permitted to create or approve pull requests.
```

**Job URL**: https://github.com/theseedship/duckdb_mcp_node/actions/runs/18623248377/job/53097319160

## ✅ Solution - Enable PR Creation Permissions

### Step 1: Go to Repository Settings

Visit: https://github.com/theseedship/duckdb_mcp_node/settings/actions

### Step 2: Update Workflow Permissions

1. Scroll to **"Workflow permissions"** section
2. Select **"Read and write permissions"** (au lieu de "Read repository contents and packages permissions")
3. **Check the box**: ☑️ "Allow GitHub Actions to create and approve pull requests"
4. Click **"Save"**

### Visual Guide

```
Settings > Actions > General > Workflow permissions

⚪ Read repository contents and packages permissions
🔘 Read and write permissions  <-- Sélectionner celui-ci

☑️ Allow GitHub Actions to create and approve pull requests  <-- Cocher cette case

[Save]
```

## 🎯 What Will Happen After Fix

Une fois les permissions activées, le workflow `release-please` pourra:

1. ✅ Créer automatiquement une Pull Request avec:
   - Version bump 0.6.10 → 0.7.0
   - CHANGELOG mis à jour
   - Tag v0.7.0

2. ✅ Quand tu merges la PR, le workflow `publish.yml` se déclenchera automatiquement pour:
   - Build le package
   - Publier sur npm
   - Créer une GitHub Release

## 🚀 Alternative: Publication Manuelle (Plus Rapide)

Si tu veux publier immédiatement sans attendre le workflow:

```bash
cd /home/nico/code_source/tss/duckdb_mcp_node

# Login to npm (if not already)
npm login

# Publish with public access
npm publish --access public
```

Cela publiera directement v0.7.0 sur npm sans passer par GitHub Actions.

## 📊 Status Actuel

- ✅ Code prêt à publier
- ✅ Version 0.7.0 dans package.json
- ✅ Tag v0.7.0 créé et pushé
- ✅ Commits pushés sur GitHub
- ✅ Workflow fix appliqué (package-name removed)
- ⚠️ **Bloqué par**: Permissions GitHub Actions

## 🔍 Vérification Post-Fix

Une fois les permissions activées, tu peux vérifier que ça marche:

```bash
# Déclencher manuellement le workflow release-please
gh workflow run release-please.yml

# Ou attendre le prochain push sur main qui le déclenchera automatiquement
```

---

**Date**: 2025-10-19
**Issue**: GitHub Actions permissions
**Solution**: Enable PR creation in repository settings
**Liens utiles**:

- Settings: https://github.com/theseedship/duckdb_mcp_node/settings/actions
- Documentation: https://docs.github.com/rest/pulls/pulls#create-a-pull-request
