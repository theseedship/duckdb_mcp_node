Problèmes détectés
Le handler ReadResource construit la requête SELECT \* FROM ${tableName} directement à partir de l’URI fournie (duckdb://table/...) sans aucun échappement. Un nom forgé comme duckdb://table/data; DROP TABLE users; -- sera exécuté tel quel par DuckDB, ce qui ouvre la porte à une injection SQL lors de la lecture d’une ressource.
src/server/mcp-server.ts
Lines 758-797
Suggested task
Protéger la lecture des ressources contre l’injection SQL

Start task
Plusieurs chemins de création/suppression de tables utilisent des noms fournis par l’utilisateur sans échappement : mapCSVResource, mapParquetResource et unmapResource interpolent tableName directement, et materializeVirtualTable fait de même pour les noms de tables source/cible. Cela permet à un alias malveillant de rompre la requête ou d’injecter des commandes arbitraires dans DuckDB.
src/client/ResourceMapper.ts
Lines 165-216
src/client/ResourceMapper.ts
Lines 284-296
src/client/VirtualTable.ts
Lines 293-303
Suggested task
Sécuriser les noms de tables dans les mappages MCP

Start task
Certaines constructions SQL incorporent directement des chaînes de configuration : les secrets S3 (KEY_ID, SECRET, ENDPOINT, etc.), les chemins d’export ('${outputPath}') et la requête tableExists interpolent les valeurs sans échappement. Des identifiants ou chemins contenant ' cassent la requête et peuvent aussi être utilisés pour injecter du SQL.
src/duckdb/service.ts
Lines 85-96
src/duckdb/service.ts
Lines 232-266
Suggested task
Échapper toutes les chaînes insérées dans les requêtes DuckDB

Problèmes identifiés
La création, le rafraîchissement et la suppression des tables virtuelles dans ResourceMapper concatènent directement tableName et, pour les ressources Parquet, la chaîne data dans les requêtes SQL. Cela permet à un alias de table ou à un chemin malveillant de casser la requête et d’exécuter du SQL arbitraire, ou tout simplement de faire échouer la commande pour des noms légitimes contenant des caractères spéciaux.
src/client/ResourceMapper.ts
Lines 91-213
src/client/ResourceMapper.ts
Lines 284-306
Suggested task
Sécuriser les requêtes SQL dans ResourceMapper

Start task
Le serveur MCP construit la requête SELECT \* FROM ${tableName} directement à partir de l’URI demandée. Un client peut injecter du SQL via le nom de table (duckdb://table/foo;DROP TABLE bar) et exécuter des commandes arbitraires, ou simplement provoquer une erreur avec un nom légitime nécessitant des guillemets.
src/server/mcp-server.ts
Lines 775-796
Suggested task
Échapper le nom de table lors de la lecture d'une ressource DuckDB

Le gestionnaire ReadResourceRequestSchema construit la requête SELECT \* FROM ${tableName} directement à partir de l’URI, sans échapper ni valider l’identifiant : une URI malicieuse peut injecter du SQL et exécuter des commandes arbitraires sur DuckDB.
src/server/mcp-server.ts
Lines 773-796
Suggested task
Sécuriser la lecture d’une ressource DuckDB

Start task
Les méthodes mapCSVResource et mapParquetResource de ResourceMapper interpolent directement tableName et des chemins/provenances contrôlés par l’extérieur dans des requêtes CREATE TABLE, ouvrant la porte à l’injection SQL si un MCP distant fournit des valeurs forgées.
src/client/ResourceMapper.ts
Lines 165-214

Suggested task
Durcir l’échappement lors du mappage de ressources
