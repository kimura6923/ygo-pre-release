# YGOPro Super Pre マージスクリプト

このスクリプトは、YGOPro Super Preの3つのバージョン（pre1、pre2、pre3）を順番にマージし、削除されたファイルも保持するNode.jsスクリプトです。

## 機能

- **順次マージ**: ygopro-super-pre1 → ygopro-super-pre2 → ygopro-super-pre3 の順でマージ
- **削除データ保持**: バージョンアップで削除されたファイルも保持
- **CDBファイルマージ**: SQLiteデータベース（カードデータベース）の統合
- **YPKファイル作成**: マージ結果からYGOPro拡張パックファイルを作成
- **動的バージョン検出**: ygopro-super-pre*フォルダを自動検出
- **詳細ログ**: マージ結果をJSON形式でログ出力
- **差分検出**: ファイルの追加・変更・削除を正確に検出

## 使用方法

### 前提条件

- Node.js 22.19.0 以上
- asdf（バージョン管理ツール）

### 実行手順

1. **Node.jsの設定**
   ```bash
   asdf set nodejs 22.19.0
   ```

2. **スクリプトの実行**
   ```bash
   node merge-ygopro.js
   ```

3. **結果の確認**
   - マージ結果: `ygopro-super-merged/` ディレクトリ
   - YPKファイル: `ygopro-super-pre-merged.ypk`
   - 詳細ログ: `merge-log.txt` ファイル

## 注意事項

- 既存の `ygopro-super-merged` ディレクトリは上書きされます
- 既存の `ygopro-super-pre-merged.ypk` ファイルは上書きされます
- 隠しファイル（.で始まるファイル）は処理対象外です
- ファイルの内容比較は文字列ベースで行われます
- CDBファイルはSQLiteデータベースとして処理されます
- YPKファイルはZIP形式で作成されます
- 大容量ファイルの処理には時間がかかる場合があります

## トラブルシューティング

### Node.jsが見つからない場合
```bash
asdf install nodejs 22.19.0
asdf set nodejs 22.19.0
```

### 権限エラーが発生した場合
```bash
chmod +x merge-ygopro.js
```

### メモリ不足が発生した場合
- 大きなファイルを分割して処理するか、Node.jsのメモリ制限を調整してください
