#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * YPKファイル作成クラス
 * マージされたYGOProデータからYPKファイルを作成する
 */
class YPKCreator {
    constructor() {
        this.baseDir = __dirname;
        this.sourceDir = 'ygopro-super-merged';
        this.outputFile = 'c.ypk';
        this.tempDir = 'temp_ypk_creation';
    }

    /**
     * YPKファイルを作成
     */
    async createYPK() {
        console.log('📦 YPKファイルの作成を開始します...\n');
        
        try {
            // ソースディレクトリの存在確認
            if (!fs.existsSync(this.sourceDir)) {
                throw new Error(`ソースディレクトリが見つかりません: ${this.sourceDir}`);
            }

            // 一時ディレクトリを作成
            this.createTempDirectory();
            
            // ファイルをコピー
            await this.copyFilesToTemp();
            
            // corres_srv.iniを更新
            this.updateCorresSrvIni();
            
            // ZIPファイルを作成
            await this.createZipFile();
            
            // 一時ディレクトリを削除
            this.cleanupTempDirectory();
            
            console.log('\n✅ YPKファイルの作成が完了しました！');
            console.log(`📦 出力ファイル: ${this.outputFile}`);
            
        } catch (error) {
            console.error('❌ YPK作成エラー:', error.message);
            this.cleanupTempDirectory();
            throw error;
        }
    }

    /**
     * 一時ディレクトリを作成
     */
    createTempDirectory() {
        if (fs.existsSync(this.tempDir)) {
            fs.rmSync(this.tempDir, { recursive: true });
        }
        fs.mkdirSync(this.tempDir, { recursive: true });
        console.log(`📂 一時ディレクトリを作成: ${this.tempDir}`);
    }

    /**
     * ファイルを一時ディレクトリにコピー
     */
    async copyFilesToTemp() {
        const sourcePath = path.join(this.baseDir, this.sourceDir);
        const tempPath = path.join(this.baseDir, this.tempDir);
        
        await this.copyDirectory(sourcePath, tempPath);
        console.log(`📋 ファイルをコピー: ${this.sourceDir} → ${this.tempDir}`);
    }

    /**
     * corres_srv.iniを更新
     */
    updateCorresSrvIni() {
        const iniPath = path.join(this.baseDir, this.tempDir, 'corres_srv.ini');
        
        if (!fs.existsSync(iniPath)) {
            console.log('⚠️  corres_srv.iniが見つかりません。新規作成します。');
            this.createNewCorresSrvIni(iniPath);
            return;
        }

        let content = fs.readFileSync(iniPath, 'utf8');
        
        // ファイル名を更新
        content = content.replace(
            /FileName = .*/,
            `FileName = ${this.outputFile}`
        );
        
        // パック名を更新
        content = content.replace(
            /PackName = .*/,
            'PackName = c'
        );
        
        // サーバー名を更新
        content = content.replace(
            /ServerName = .*/,
            'ServerName = 萌卡超先行統合区'
        );
        
        // サーバー説明を更新
        content = content.replace(
            /ServerDesc = .*/,
            'ServerDesc = 全バージョンを統合した超先行カードパック（削除データも保持）'
        );
        
        fs.writeFileSync(iniPath, content, 'utf8');
        console.log(`📝 corres_srv.iniを更新しました`);
    }

    /**
     * 新しいcorres_srv.iniを作成
     */
    createNewCorresSrvIni(iniPath) {
        const content = `[YGOProExpansionPack]
FileName = ${this.outputFile}
PackName = c
PackAuthor = Mycard
PackHomePage = https://mycard.world/
[YGOMobileAddServer]
ServerName = 萌卡超先行統合区
ServerDesc = 全バージョンを統合した超先行カードパック（削除データも保持）
ServerHost = mygo2.superpre.pro
ServerPort = 888
`;
        fs.writeFileSync(iniPath, content, 'utf8');
    }

    /**
     * ZIPファイルを作成
     */
    async createZipFile() {
        const tempPath = path.join(this.baseDir, this.tempDir);
        const outputPath = path.join(this.baseDir, this.outputFile);
        
        // 既存のYPKファイルを削除
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }
        
        // ZIPファイルを作成
        try {
            execSync(`cd "${tempPath}" && zip -r "${outputPath}" .`, { stdio: 'pipe' });
            console.log(`📦 ZIPファイルを作成: ${this.outputFile}`);
        } catch (error) {
            throw new Error(`ZIPファイルの作成に失敗しました: ${error.message}`);
        }
    }

    /**
     * 一時ディレクトリを削除
     */
    cleanupTempDirectory() {
        if (fs.existsSync(this.tempDir)) {
            fs.rmSync(this.tempDir, { recursive: true });
            console.log(`🗑️  一時ディレクトリを削除: ${this.tempDir}`);
        }
    }

    /**
     * ディレクトリを再帰的にコピー
     */
    async copyDirectory(source, target) {
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }
        
        const items = fs.readdirSync(source, { withFileTypes: true });
        
        for (const item of items) {
            if (item.name.startsWith('.')) continue; // 隠しファイルをスキップ
            
            const sourcePath = path.join(source, item.name);
            const targetPath = path.join(target, item.name);
            
            if (item.isDirectory()) {
                await this.copyDirectory(sourcePath, targetPath);
            } else {
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }

    /**
     * YPKファイルの情報を表示
     */
    showYPKInfo() {
        const outputPath = path.join(this.baseDir, this.outputFile);
        
        if (!fs.existsSync(outputPath)) {
            console.log('❌ YPKファイルが見つかりません');
            return;
        }

        const stats = fs.statSync(outputPath);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log('\n📊 YPKファイル情報:');
        console.log(`  - ファイル名: ${this.outputFile}`);
        console.log(`  - サイズ: ${sizeInMB} MB`);
        console.log(`  - 作成日時: ${stats.mtime.toLocaleString()}`);
        
        // ZIPファイルの内容を確認
        try {
            const fileCount = execSync(`unzip -l "${outputPath}" | tail -1 | awk '{print $2}'`, { encoding: 'utf8' }).trim();
            console.log(`  - ファイル数: ${fileCount}個`);
        } catch (error) {
            console.log('  - ファイル数: 確認できませんでした');
        }
    }
}

module.exports = YPKCreator;
