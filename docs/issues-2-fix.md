Injection SQL via interpolation directe des entrées utilisateur
Les gestionnaires MCP construisent des requêtes en interpolant schema, table_name, path, etc. directement dans les chaînes SQL (ex. CREATE OR REPLACE TABLE ${tableName}), ce qui permet à un client malveillant d’injecter des instructions arbitraires via les paramètres des outils list_tables, describe_table, load_csv, load_parquet, etc.
Côté DuckDBService, la plupart des helpers réutilisent le même schéma d’interpolation naïve (ex. WHERE table_schema = '${schema}', INSERT INTO ${tableName} VALUES (...), read_csv_auto('${path}')), renforçant cette surface d’attaque et permettant même de détourner les chemins de fichiers.
src/server/mcp-server.ts
Lines 379-455
src/duckdb/service.ts
Lines 146-204

Suggested task
Sécuriser la construction des requêtes SQL du serveur MCP

Résumé
La création de tables virtuelles tombe en échec dès qu’une ressource retournée par un serveur MCP n’est pas déjà sérialisée en JSON, ce qui rend impossibles les cas d’usage CSV/Parquet pourtant prévus par l’API.

L’attachement de serveurs MCP via stdio:// ne fonctionne pas dès qu’on doit invoquer un binaire via son chemin (absolu ou relatif), car le parsing tronque systématiquement ce chemin.

Détails
Les ressources non JSON provoquent des erreurs bloquantes
readResource applique toujours JSON.parse sur le contenu textuel renvoyé par le serveur MCP sans tenir compte du MIME type ; toute ressource CSV, texte brut ou binaire va donc lever une exception, ce qui empêche VirtualTableManager (et les outils create_virtual_table / refresh_virtual_table) d’exploiter les types pris en charge par ResourceMapper (CSV/Parquet).
src/client/MCPClient.ts
Lines 212-296
src/client/VirtualTable.ts
Lines 68-125
src/client/ResourceMapper.ts
Lines 6-191
Suggested task
Permettre au client MCP de manipuler des ressources non JSON

Impossible de lancer un serveur MCP via son chemin
Lors de l’attachement stdio://, le code récupère urlParts.hostname || urlParts.pathname.slice(2). Pour un binaire adressé par un chemin (stdio:///usr/bin/python, stdio://./bin/script, etc.), hostname est vide et pathname.slice(2) supprime les deux premiers caractères, coupant donc le début du chemin et empêchant le spawn du processus
src/client/MCPClient.ts
Lines 65-137
Suggested task
Corriger l’extraction de commande dans attachServer

Vulnérabilité majeure : construction des requêtes SQL sans échappement
Plusieurs chemins permettent à un client MCP d’injecter du SQL arbitraire, car des valeurs fournies par l’utilisateur (noms de schémas, de tables, chemins, clés JSON) sont interpolées telles quelles dans les requêtes. Les outils list_tables, load_csv, load_parquet, etc. du serveur composent directement leurs requêtes avec les arguments MCP, sans la moindre neutralisation des quotes ou mots-clés ; un alias malveillant comme evil'; DROP TABLE users; -- transformera la requête générée en commande destructive.
src/server/mcp-server.ts
Lines 379-468
Le service DuckDB et le ResourceMapper reproduisent le même anti-pattern en réutilisant les identifiants utilisateurs dans getTableColumns, getRowCount, createTableFromJSON, mapCSVResource, mapParquetResource, etc., ouvrant la porte à l’exécution d’ordres non voulus dès qu’un jeu de données externe contient un nom de colonne ou de table malicieusement forgé.
src/duckdb/service.ts
Lines 146-275
src/client/ResourceMapper.ts
Lines 159-213
En production, cela annule la protection supposée de validateQuery, qui ne s’applique qu’aux requêtes passées dans sql, et permet de modifier/détruire des données voire d’exécuter du code DuckDB côté serveur.

Suggested task
Sécuriser la construction des requêtes SQL pour les identifiants
