Problème majeur
Lorsque readResource reçoit un Parquet (blob base64), il l’écrit dans un fichier temporaire et renvoie un objet { type: 'parquet', path: ... }. Or ResourceMapper.mapResource détecte le type en sérialisant cet objet ; comme la chaîne résultante commence par {, la ressource est à tort classée comme JSON et mapJSONResource crée une table DuckDB contenant uniquement les colonnes type et path, sans jamais lire le Parquet réel. Résultat : les tables « virtuelles » issues d’un Parquet ne contiennent pas les données attendues et la logique de fichiers temporaires ne s’exécute pas jusqu’au bout.
src/client/MCPClient.ts
Lines 224-31
src/client/ResourceMapper.ts
Lines 43-161

Suggested task
Correctly load Parquet resources into virtual tables

Problèmes détectés
Les tables virtuelles créées à partir de ressources Parquet ne contiennent jamais les données réelles
Quand une ressource MCP renvoie un Parquet en binaire, readResource retourne un objet { type: 'parquet', path }. VirtualTableManager.createVirtualTable transmet cet objet tel quel au ResourceMapper, sans méta-données supplémentaires.
src/client/MCPClient.ts
Lines 270-314
src/client/VirtualTable.ts
Lines 68-85
Dans ResourceMapper.mapResource, ce type d’objet est stringifié, détecté comme JSON et envoyé vers mapJSONResource, ce qui crée une table avec une seule ligne contenant les champs type et path au lieu de charger le fichier Parquet. Même si la détection était corrigée, mapParquetResource n’accepte que des chaînes ou des buffers et rejetterait toujours l’objet { type, path }. Résultat : les outils create_virtual_table/refresh_virtual_table ne peuvent pas exploiter les ressources Parquet malgré la fonctionnalité annoncée.
src/client/ResourceMapper.ts
Lines 87-129
src/client/ResourceMapper.ts
Lines 197-219
Suggested task
Gérer correctement les blobs Parquet lors de la création de tables virtuelles

Résumé
Le cache de MCPClient.readResource garde l’objet { type: 'parquet', path } alors que createVirtualTable supprime immédiatement ce fichier temporaire, ce qui rend tout accès ultérieur à la ressource impossible dès que le cache est utilisé.
src/client/MCPClient.ts
Lines 270-311
src/client/MCPClient.ts
Lines 364-377

Les ressources Parquet sont systématiquement requalifiées en JSON dans ResourceMapper.mapResource, faute de propager un indicateur/MIME type, si bien que les tables virtuelles créées contiennent seulement les métadonnées { type, path } et jamais les données Parquet réelles.
src/client/MCPClient.ts
Lines 270-311
src/client/MCPClient.ts
Lines 364-377
Suggested task
Sécuriser la mise en cache des fichiers Parquet

VirtualTableManager transmet l’objet { type: 'parquet', path } sans MIME type, et ResourceMapper.mapResource le traite comme du JSON ; la table virtuelle résultante ne contient donc pas les données Parquet mais uniquement ce wrapper technique.
src/client/MCPClient.ts
Lines 270-313
src/client/VirtualTable.ts
Lines 68-85
src/client/ResourceMapper.ts
Lines 80-107
Suggested task
Faire reconnaître correctement les Parquet dans ResourceMapper
