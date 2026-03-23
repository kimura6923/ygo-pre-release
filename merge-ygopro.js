#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const CDBMerger = require('./cdb-merger');
const YPKCreator = require('./ypk-creator');

/**
 * YGOPro Super Pre バージョンマージスクリプト
 * ygopro-super-pre1 → ygopro-super-pre2 → ygopro-super-pre3 の順でマージ
 * 削除されたファイルも保持する
 */

class YGOProMerger {
    constructor() {
        this.baseDir = __dirname;
        this.versions = this.detectVersions();
        this.outputDir = 'ygopro-super-merged';
        this.logFile = 'merge-log.txt';
        this.deletedFiles = [];
        this.modifiedFiles = [];
        this.addedFiles = [];
        this.cdbMerger = new CDBMerger(this.versions);
        this.ypkCreator = new YPKCreator();
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
        
        console.log(`🔍 検出されたバージョン: ${versions.join(', ')}`);
        return versions;
    }

    /**
     * メイン実行関数
     */
    async merge() {
        console.log('🚀 YGOPro Super Pre マージを開始します...\n');
        
        try {
            // 出力ディレクトリを作成
            this.createOutputDirectory();
            
            // 各バージョンを順番にマージ
            for (let i = 0; i < this.versions.length; i++) {
                const version = this.versions[i];
                console.log(`📁 ${version} を処理中...`);
                
                if (i === 0) {
                    // 最初のバージョンはそのままコピー
                    await this.copyFirstVersion(version);
                } else {
                    // 2番目以降は差分をマージ
                    await this.mergeVersion(version, i);
                }
            }
            
            // CDBファイルをマージ
            await this.cdbMerger.mergeCDBFiles();
            
            // YPKファイルを作成
            await this.ypkCreator.createYPK();
            this.ypkCreator.showYPKInfo();
            
            // マージ結果をレポート
            this.generateReport();
            
            console.log('\n✅ マージが完了しました！');
            console.log(`📊 結果: ${this.outputDir}/ に保存されました`);
            console.log(`📦 YPK: ${this.ypkCreator.outputFile} が作成されました`);
            console.log(`📝 ログ: ${this.logFile} を確認してください`);
            
        } catch (error) {
            console.error('❌ エラーが発生しました:', error.message);
            process.exit(1);
        }
    }

    /**
     * 出力ディレクトリを作成
     */
    createOutputDirectory() {
        if (fs.existsSync(this.outputDir)) {
            fs.rmSync(this.outputDir, { recursive: true });
        }
        fs.mkdirSync(this.outputDir, { recursive: true });
        console.log(`📂 出力ディレクトリを作成: ${this.outputDir}`);
    }

    /**
     * 最初のバージョンをコピー
     */
    async copyFirstVersion(version) {
        const sourcePath = path.join(this.baseDir, version);
        const targetPath = path.join(this.baseDir, this.outputDir);
        
        await this.copyDirectory(sourcePath, targetPath);
        console.log(`  ✅ ${version} をベースとしてコピー完了`);
    }

    /**
     * バージョンをマージ
     */
    async mergeVersion(version, versionIndex) {
        const sourcePath = path.join(this.baseDir, version);
        const targetPath = path.join(this.baseDir, this.outputDir);
        
        // ディレクトリ構造を取得
        const sourceStructure = this.getDirectoryStructure(sourcePath);
        const targetStructure = this.getDirectoryStructure(targetPath);
        
        // ファイルの差分を分析
        const changes = this.analyzeChanges(sourceStructure, targetStructure, version);
        
        // 変更を適用
        await this.applyChanges(sourcePath, targetPath, changes, version);
        
        console.log(`  ✅ ${version} のマージ完了`);
        console.log(`    - 追加: ${changes.added.length} ファイル`);
        console.log(`    - 変更: ${changes.modified.length} ファイル`);
        console.log(`    - 削除: ${changes.deleted.length} ファイル (保持)`);
    }

    /**
     * ディレクトリ構造を取得
     */
    getDirectoryStructure(dirPath) {
        const structure = {};
        
        if (!fs.existsSync(dirPath)) {
            return structure;
        }
        
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const item of items) {
            if (item.name.startsWith('.')) continue; // 隠しファイルをスキップ
            
            const fullPath = path.join(dirPath, item.name);
            const relativePath = path.relative(dirPath, fullPath);
            
            if (item.isDirectory()) {
                structure[relativePath] = {
                    type: 'directory',
                    children: this.getDirectoryStructure(fullPath)
                };
            } else {
                structure[relativePath] = {
                    type: 'file',
                    size: fs.statSync(fullPath).size,
                    mtime: fs.statSync(fullPath).mtime
                };
            }
        }
        
        return structure;
    }

    /**
     * 変更を分析
     */
    analyzeChanges(sourceStructure, targetStructure, version) {
        const changes = {
            added: [],
            modified: [],
            deleted: []
        };
        
        // 追加・変更されたファイルを検出
        for (const [relativePath, sourceInfo] of Object.entries(sourceStructure)) {
            const targetInfo = targetStructure[relativePath];
            
            if (!targetInfo) {
                changes.added.push(relativePath);
            } else if (sourceInfo.type === 'file' && targetInfo.type === 'file') {
                // ファイルの内容を比較
                if (this.isFileDifferent(relativePath, version)) {
                    changes.modified.push(relativePath);
                }
            } else if (sourceInfo.type === 'directory' && targetInfo.type === 'directory') {
                // ディレクトリの場合は再帰的に処理
                const subChanges = this.analyzeChanges(sourceInfo.children, targetInfo.children, version);
                changes.added.push(...subChanges.added.map(p => path.join(relativePath, p)));
                changes.modified.push(...subChanges.modified.map(p => path.join(relativePath, p)));
                changes.deleted.push(...subChanges.deleted.map(p => path.join(relativePath, p)));
            }
        }
        
        // 削除されたファイルを検出（保持するため）
        for (const [relativePath, targetInfo] of Object.entries(targetStructure)) {
            const sourceInfo = sourceStructure[relativePath];
            
            if (!sourceInfo) {
                changes.deleted.push(relativePath);
            }
        }
        
        return changes;
    }

    /**
     * ファイルが異なるかチェック
     */
    isFileDifferent(relativePath, version) {
        const sourcePath = path.join(this.baseDir, version, relativePath);
        const targetPath = path.join(this.baseDir, this.outputDir, relativePath);
        
        if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) {
            return true;
        }
        
        const sourceContent = fs.readFileSync(sourcePath, 'utf8');
        const targetContent = fs.readFileSync(targetPath, 'utf8');
        
        return sourceContent !== targetContent;
    }

    /**
     * 変更を適用
     */
    async applyChanges(sourcePath, targetPath, changes, version) {
        // 追加・変更されたファイルをコピー
        for (const filePath of [...changes.added, ...changes.modified]) {
            const sourceFile = path.join(sourcePath, filePath);
            const targetFile = path.join(targetPath, filePath);
            
            // ディレクトリを作成
            const targetDir = path.dirname(targetFile);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            // ファイルをコピー
            fs.copyFileSync(sourceFile, targetFile);
            
            if (changes.added.includes(filePath)) {
                this.addedFiles.push({ version, file: filePath });
            } else {
                this.modifiedFiles.push({ version, file: filePath });
            }
        }
        
        // 削除されたファイルを記録（保持するため）
        for (const filePath of changes.deleted) {
            this.deletedFiles.push({ version, file: filePath });
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
     * レポートを生成
     */
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalAdded: this.addedFiles.length,
                totalModified: this.modifiedFiles.length,
                totalDeleted: this.deletedFiles.length
            },
            details: {
                added: this.addedFiles,
                modified: this.modifiedFiles,
                deleted: this.deletedFiles
            }
        };
        
        // ログファイルに保存
        fs.writeFileSync(this.logFile, JSON.stringify(report, null, 2), 'utf8');
        
        // コンソールにサマリーを表示
        console.log('\n📊 マージ結果サマリー:');
        console.log(`  - 追加されたファイル: ${report.summary.totalAdded}`);
        console.log(`  - 変更されたファイル: ${report.summary.totalModified}`);
        console.log(`  - 削除されたファイル: ${report.summary.totalDeleted} (保持済み)`);
        
        // バージョン別の詳細
        console.log('\n📋 バージョン別詳細:');
        for (const version of this.versions) {
            const added = this.addedFiles.filter(f => f.version === version).length;
            const modified = this.modifiedFiles.filter(f => f.version === version).length;
            const deleted = this.deletedFiles.filter(f => f.version === version).length;
            
            console.log(`  ${version}:`);
            console.log(`    - 追加: ${added} ファイル`);
            console.log(`    - 変更: ${modified} ファイル`);
            console.log(`    - 削除: ${deleted} ファイル`);
        }
    }
}

// スクリプト実行
if (require.main === module) {
    const merger = new YGOProMerger();
    merger.merge().catch(console.error);
}

module.exports = YGOProMerger;
