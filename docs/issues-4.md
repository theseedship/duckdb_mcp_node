Problèmes majeurs détectés
MCPClient.createVirtualTable n’accepte que des tableaux JSON : lorsque readResource reçoit du CSV ou du texte brut, il renvoie simplement la chaîne (mimeType.includes('csv')), mais createVirtualTable rejette toute donnée qui n’est pas un tableau et tente toujours createTableFromJSON. Résultat : créer une table virtuelle sur une ressource CSV échoue systématiquement malgré les fonctionnalités annoncées.
src/client/MCPClient.ts
Lines 280-333
Suggested task
Permettre à MCPClient.createVirtualTable de gérer les ressources non JSON

Start task
readResource ignore totalement les contenus binaires (content.blob). Si un serveur MCP renvoie un Parquet en binaire, data reste à null, est mis en cache ainsi, et toute tentative de mappage lève une erreur “Unsupported resource type”. Cela bloque l’un des cas d’usage principaux (tables virtuelles à partir de Parquet).
src/client/MCPClient.ts
Lines 224-301
Suggested task
Supporter les blobs MCP dans readResource

Start task
MCPClient.refreshVirtualTable invalide le cache avec serverAlias ? \${serverAlias}:${resourceUri}` : resourceUri. Or readResourcenormalise toujours la clé de cache au formatalias:path. Si on fournit une URI complète mcp://alias/path` (cas classique), l’invalidation n’efface rien et la table se recharge avec les données périmées.
src/client/MCPClient.ts
Lines 224-348
Suggested task
Aligner la clé de cache dans refreshVirtualTable

Problèmes détectés
Injection SQL possible via DuckDBService.tableExists – La requête construite pour vérifier l’existence d’une table concatène directement le schéma et le nom de table fournis sans aucun échappement ('${schema}' / '${tableName}'). Un appelant peut donc injecter des quotes ou du SQL arbitraire, ce qui compromet la base ou provoque des erreurs pour des noms légitimes contenant des caractères spéciaux.
src/duckdb/service.ts
Lines 257-265
Suggested task
Sécuriser DuckDBService.tableExists contre l’injection SQL

Start task
Le schéma est ignoré lors du calcul du nombre de lignes dans describe_table – Le handler appelle getRowCount(tableName) sans transmettre le schéma demandé. Pour une table située hors du schéma main, la requête générée SELECT COUNT(\*) FROM "table" échouera car la table attendue est schema.table. Résultat : l’outil describe_table casse dès qu’on renseigne un schéma non par défaut.
src/server/mcp-server.ts
Lines 409-414
src/duckdb/service.ts
Lines 271-274
Suggested task
Respecter le schéma lors du calcul du row count

Problèmes identifiés
Création du secret S3 vulnérable aux caractères spéciaux/injection – la requête CREATE SECRET insère directement accessKey, secretKey, endpoint et region sans échappement. La présence d’une apostrophe casse l’initialisation et ouvre aussi une surface d’injection SQL.
src/duckdb/service.ts
Lines 83-96
Suggested task
Échapper les identifiants S3 lors de configureS3

Start task
Export de résultats : chemin de sortie injecté tel quel – exportToFile place outputPath directement entre quotes dans la commande COPY, ce qui casse la requête si le chemin contient ' et permet aussi l’injection de SQL arbitraire.
src/duckdb/service.ts
Lines 228-251
Suggested task
Sécuriser le chemin dans exportToFile

Start task
tableExists : schéma et table interpolés sans échappement – la requête sur information_schema.tables incorpore les paramètres bruts. Un nom contenant ' échoue et une valeur forgée peut injecter du SQL.
src/duckdb/service.ts
Lines 257-265
Suggested task
Échapper les paramètres dans tableExists
