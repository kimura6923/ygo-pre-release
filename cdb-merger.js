#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * CDBファイル（SQLiteデータベース）マージクラス
 * YGOProのカードデータベースをマージし、削除されたカードも保持する
 */
class CDBMerger {
    constructor(versions = null) {
        this.baseDir = __dirname;
        this.versions = versions || this.detectVersions();
        this.outputDir = 'ygopro-super-merged';
        this.cdbFiles = ['test-release.cdb', 'test-update.cdb'];
        this.mergeStats = {
            totalCards: 0,
            addedCards: 0,
            updatedCards: 0,
            preservedCards: 0
        };
    }

    /**
     * ygopro-super-pre* フォルダを動的に検出
     */
    detectVersions() {
        const versions = [];
        const items = fs.readdirSync(this.baseDir, { withFileTypes: true });
        
        for (const item of items) {
            if (item.isDirectory() && item.name.startsWith('ygopro-super-pre')) {
                versions.push(item.name);
            }
        }
        
        // バージョン番号でソート（pre1, pre2, pre3, pre4, pre5...）
        versions.sort((a, b) => {
            const aNum = parseInt(a.replace('ygopro-super-pre', ''));
            const bNum = parseInt(b.replace('ygopro-super-pre', ''));
            return aNum - bNum;
        });
        
        return versions;
    }

    /**
     * CDBファイルをマージ
     */
    async mergeCDBFiles() {
        console.log('🗄️  CDBファイルのマージを開始します...\n');
        
        try {
            for (const cdbFile of this.cdbFiles) {
                console.log(`📊 ${cdbFile} を処理中...`);
                await this.mergeCDBFile(cdbFile);
            }
            
            this.generateCDBReport();
            console.log('\n✅ CDBファイルのマージが完了しました！');
            
        } catch (error) {
            console.error('❌ CDBマージエラー:', error.message);
            throw error;
        }
    }

    /**
     * 個別のCDBファイルをマージ
     */
    async mergeCDBFile(cdbFileName) {
        const outputPath = path.join(this.baseDir, this.outputDir, cdbFileName);
        const tempDir = path.join(this.baseDir, 'temp_cdb_merge');
        
        // 一時ディレクトリを作成
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            // 各バージョンのCDBファイルを分析
            const versionData = await this.analyzeCDBFiles(cdbFileName);
            
            // マージされたデータベースを作成
            await this.createMergedCDB(versionData, outputPath, tempDir);
            
            console.log(`  ✅ ${cdbFileName} のマージ完了`);
            console.log(`    - 総カード数: ${versionData.totalCards}`);
            console.log(`    - 追加カード: ${versionData.addedCards}`);
            console.log(`    - 更新カード: ${versionData.updatedCards}`);
            console.log(`    - 保持カード: ${versionData.preservedCards}`);
            
        } finally {
            // 一時ディレクトリを削除
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true });
            }
        }
    }

    /**
     * 各バージョンのCDBファイルを分析
     */
    async analyzeCDBFiles(cdbFileName) {
        const versionData = {
            totalCards: 0,
            addedCards: 0,
            updatedCards: 0,
            preservedCards: 0,
            cards: new Map(), // id -> { data, text, version, isDeleted }
            versions: []
        };

        for (const version of this.versions) {
            const cdbPath = path.join(this.baseDir, version, cdbFileName);
            
            if (!fs.existsSync(cdbPath)) {
                console.log(`    ⚠️  ${version}/${cdbFileName} が見つかりません`);
                continue;
            }

            const cards = await this.extractCardsFromCDB(cdbPath);
            versionData.versions.push({ version, cardCount: cards.length });
            
            for (const card of cards) {
                const existingCard = versionData.cards.get(card.id);
                
                if (!existingCard) {
                    // 新しいカード
                    versionData.cards.set(card.id, {
                        data: card.data,
                        text: card.text,
                        version: version,
                        isDeleted: false,
                        history: [version]
                    });
                    versionData.addedCards++;
                } else {
                    // 既存カードの更新
                    if (this.isCardDifferent(existingCard, card)) {
                        existingCard.data = card.data;
                        existingCard.text = card.text;
                        existingCard.version = version;
                        existingCard.history.push(version);
                        versionData.updatedCards++;
                    }
                }
            }
        }

        // 削除されたカードを検出（前のバージョンに存在したが後のバージョンに存在しない）
        this.detectDeletedCards(versionData);
        
        versionData.totalCards = versionData.cards.size;
        versionData.preservedCards = Array.from(versionData.cards.values())
            .filter(card => card.isDeleted).length;

        return versionData;
    }

    /**
     * CDBファイルからカードデータを抽出
     */
    async extractCardsFromCDB(cdbPath) {
        const cards = [];
        
        try {
            // 一時ファイルを使用してSQLiteの出力を安全に処理
            const tempDir = path.join(this.baseDir, 'temp_cdb_parse');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const datasFile = path.join(tempDir, 'datas.txt');
            const textsFile = path.join(tempDir, 'texts.txt');
            
            // datasテーブルからカードデータを取得
            const datasQuery = `SELECT * FROM datas ORDER BY id`;
            execSync(`sqlite3 "${cdbPath}" -separator "|||" "${datasQuery}" > "${datasFile}"`);
            
            // textsテーブルからカードテキストを取得（改行を保持）
            const textsQuery = `SELECT * FROM texts ORDER BY id`;
            execSync(`sqlite3 "${cdbPath}" -separator "|||" "${textsQuery}" > "${textsFile}"`);
            
            // ファイルからデータを読み込み
            const datasContent = fs.readFileSync(datasFile, 'utf8');
            const textsContent = fs.readFileSync(textsFile, 'utf8');
            
            // datasデータをパース（改行を含むデータを正しく処理）
            const datasLines = this.parseSQLiteFileContent(datasContent);
            const textsLines = this.parseSQLiteFileContent(textsContent);
            
            // デバッグ情報を追加
            console.log(`    📝 生データ行数: ${textsContent.split(/\r?\n/).length}`);
            console.log(`    📝 パース後行数: ${textsLines.length}`);
            
            // パース処理の問題を確認
            if (textsLines.length < 10) {
                console.log(`    ⚠️  パース処理に問題があります。生データの最初の5行を確認:`);
                const rawLines = textsContent.split(/\r?\n/).slice(0, 5);
                rawLines.forEach((line, i) => {
                    console.log(`    📝 生データ行${i+1}: ${line.substring(0, 100)}...`);
                });
            }
            
            // テキストデータをマップに変換
            const textMap = new Map();
            console.log(`    📝 texts行数: ${textsLines.length}`);
            
            for (const line of textsLines) {
                const parts = line.split('|||');
                if (parts.length >= 2) {
                    const id = parseInt(parts[0]);
                    textMap.set(id, parts.slice(1));
                }
            }
            console.log(`    📝 有効なtexts: ${textMap.size}件`);
            
            // カードデータを構築
            for (const line of datasLines) {
                const parts = line.split('|||');
                if (parts.length >= 11) {
                    const id = parseInt(parts[0]);
                    const card = {
                        id: id,
                        data: parts,
                        text: textMap.get(id) || []
                    };
                    cards.push(card);
                }
            }
            
            // 一時ファイルを削除
            fs.rmSync(tempDir, { recursive: true });
            
        } catch (error) {
            console.error(`CDBファイル読み込みエラー (${cdbPath}):`, error.message);
        }
        
        return cards;
    }

    /**
     * SQLiteファイルの内容を適切にパース（改行を含むデータに対応）
     */
    parseSQLiteFileContent(content) {
        // より単純で確実な方法：区切り文字|||で分割して、IDで始まる行を探す
        const lines = [];
        const rawLines = content.trim().split(/\r?\n/);
        
        let currentRecord = '';
        let recordCount = 0;
        
        for (const line of rawLines) {
            if (!line.trim()) continue;
            
            // 行がIDで始まるかチェック（数字で始まる）
            if (/^\d+\|\|\|/.test(line)) {
                // 前のレコードを保存
                if (currentRecord) {
                    lines.push(currentRecord);
                    recordCount++;
                }
                // 新しいレコードを開始
                currentRecord = line;
            } else if (currentRecord) {
                // 改行を含むデータの続き
                currentRecord += '\r\n' + line;
            }
        }
        
        // 最後のレコードを追加
        if (currentRecord) {
            lines.push(currentRecord);
            recordCount++;
        }
        
        console.log(`    📝 レコード数: ${recordCount}`);
        return lines;
    }

    /**
     * SQLiteの出力を適切にパース（改行を含むデータに対応）
     */
    parseSQLiteOutput(output) {
        const lines = [];
        const rawLines = output.trim().split(/\r?\n/);
        
        let currentLine = '';
        let expectedColumns = 0;
        
        for (const line of rawLines) {
            if (!line.trim()) continue;
            
            // 区切り文字|||で分割して、列数を確認
            const parts = line.split('|||');
            
            if (parts.length >= 2) {
                // 最初の行で列数を決定
                if (expectedColumns === 0) {
                    expectedColumns = parts.length;
                }
                
                // 前の行が未完了の場合は結合
                if (currentLine) {
                    currentLine += '\r\n' + line;
                } else {
                    currentLine = line;
                }
                
                // 適切な列数がある場合は行として追加
                if (parts.length === expectedColumns) {
                    lines.push(currentLine);
                    currentLine = '';
                }
            } else if (currentLine) {
                // 改行を含むデータの続き
                currentLine += '\r\n' + line;
            } else {
                // 新しい行の開始（IDが含まれている可能性）
                const firstPart = line.split('|||')[0];
                if (/^\d+$/.test(firstPart)) {
                    currentLine = line;
                }
            }
        }
        
        // 最後の行を追加
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines.filter(line => line.trim());
    }

    /**
     * カードが異なるかチェック
     */
    isCardDifferent(existingCard, newCard) {
        // データ部分を比較
        if (existingCard.data.length !== newCard.data.length) {
            return true;
        }
        
        for (let i = 0; i < existingCard.data.length; i++) {
            if (existingCard.data[i] !== newCard.data[i]) {
                return true;
            }
        }
        
        // テキスト部分を比較
        if (existingCard.text.length !== newCard.text.length) {
            return true;
        }
        
        for (let i = 0; i < existingCard.text.length; i++) {
            if (existingCard.text[i] !== newCard.text[i]) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * 削除されたカードを検出
     */
    detectDeletedCards(versionData) {
        const versionOrder = this.versions;
        
        for (const [cardId, card] of versionData.cards) {
            const cardVersionIndex = versionOrder.indexOf(card.version);
            
            // そのカードが後のバージョンに存在するかチェック
            let existsInLaterVersions = false;
            
            for (let i = cardVersionIndex + 1; i < versionOrder.length; i++) {
                const laterVersion = versionOrder[i];
                const laterCDBPath = path.join(this.baseDir, laterVersion, 'test-release.cdb');
                
                if (fs.existsSync(laterCDBPath)) {
                    try {
                        const checkQuery = `SELECT COUNT(*) FROM datas WHERE id = ${cardId}`;
                        const result = execSync(`sqlite3 "${laterCDBPath}" "${checkQuery}"`, { encoding: 'utf8' });
                        if (parseInt(result.trim()) > 0) {
                            existsInLaterVersions = true;
                            break;
                        }
                    } catch (error) {
                        // エラーは無視
                    }
                }
            }
            
            // 後のバージョンに存在しない場合は削除されたとマーク
            if (!existsInLaterVersions && cardVersionIndex < versionOrder.length - 1) {
                card.isDeleted = true;
            }
        }
    }

    /**
     * マージされたCDBファイルを作成
     */
    async createMergedCDB(versionData, outputPath, tempDir) {
        const tempDBPath = path.join(tempDir, 'merged.cdb');
        
        // 空のデータベースを作成
        execSync(`sqlite3 "${tempDBPath}" "CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);"`);
        execSync(`sqlite3 "${tempDBPath}" "CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);"`);
        
        // カードデータを挿入
        for (const [cardId, card] of versionData.cards) {
            // datasテーブルに挿入
            const dataValues = card.data.join(',');
            execSync(`sqlite3 "${tempDBPath}" "INSERT OR REPLACE INTO datas VALUES (${dataValues});"`);
            
            // textsテーブルに挿入
            if (card.text.length > 0) {
                // 19列分の値を準備（不足分は空文字で埋める）
                const textValues = [cardId, ...card.text];
                while (textValues.length < 19) {
                    textValues.push('');
                }
                
                // より安全な方法でSQLを実行
                const sqlFile = path.join(path.dirname(tempDBPath), 'insert_text.sql');
                const sql = this.buildInsertSQL(textValues);
                fs.writeFileSync(sqlFile, sql, 'utf8');
                execSync(`sqlite3 "${tempDBPath}" < "${sqlFile}"`);
                fs.unlinkSync(sqlFile);
            }
        }
        
        // 最終ファイルにコピー
        fs.copyFileSync(tempDBPath, outputPath);
    }

    /**
     * 安全なINSERT文を構築
     */
    buildInsertSQL(values) {
        const escapedValues = values.map(v => {
            if (v === null || v === undefined) {
                return 'NULL';
            }
            
            const str = v.toString();
            // 改行文字を適切にエスケープ（\r\nを保持）
            const escaped = str
                .replace(/\\/g, '\\\\')  // バックスラッシュをエスケープ
                .replace(/'/g, "''");    // シングルクォートをエスケープ
            return `'${escaped}'`;
        });
        
        return `INSERT OR REPLACE INTO texts VALUES (${escapedValues.join(',')});`;
    }

    /**
     * CDBマージレポートを生成
     */
    generateCDBReport() {
        const report = {
            timestamp: new Date().toISOString(),
            cdbFiles: this.cdbFiles,
            summary: this.mergeStats
        };
        
        // ログファイルに追加
        const logFile = 'merge-log.txt';
        let existingLog = {};
        
        if (fs.existsSync(logFile)) {
            try {
                existingLog = JSON.parse(fs.readFileSync(logFile, 'utf8'));
            } catch (error) {
                // 既存ログの読み込みに失敗した場合は空のオブジェクトを使用
            }
        }
        
        existingLog.cdbMerge = report;
        fs.writeFileSync(logFile, JSON.stringify(existingLog, null, 2), 'utf8');
        
        console.log('\n📊 CDBマージ結果サマリー:');
        console.log(`  - 処理されたCDBファイル: ${this.cdbFiles.length}`);
        console.log(`  - 総カード数: ${this.mergeStats.totalCards}`);
        console.log(`  - 追加カード: ${this.mergeStats.addedCards}`);
        console.log(`  - 更新カード: ${this.mergeStats.updatedCards}`);
        console.log(`  - 保持カード: ${this.mergeStats.preservedCards}`);
    }
}

module.exports = CDBMerger;
