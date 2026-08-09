# ClickHouse backup policy

- 毎日、同一host外のobject storageへClickHouseのnative `BACKUP`を取得する。
- 成功を確認してから8世代目を削除し、常に直近7世代を保持する。
- backup credentialはrepositoryやComposeへ置かず、hostのsecret managerから渡す。
- 月1回、隔離したClickHouseへ`RESTORE`し、trace/log/metricの件数と最新・最古時刻を照合する。
- SigNozのmetadata storeも同じ時点でbackupし、復元手順と所要時間をrunbookへ記録する。

Foundryが生成するservice名とvolume名はlock fileで確定するため、実環境で`pours/deployment/compose.yaml`を確認してbackup jobを作る。推測したcontainer名をrepositoryのscriptへ固定しない。
