/**
 * GitHub Backup Service
 * 
 * Stores database backups in a private GitHub repository — 100% FREE.
 * Uses the GitHub REST API to upload/download/list backup files.
 * 
 * Required env vars:
 *   GITHUB_BACKUP_TOKEN  — Personal Access Token (classic) with 'repo' scope
 *   GITHUB_BACKUP_REPO   — Format: "username/repo-name" (e.g., "pwalson/arteva-backups")
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com';
let githubEnabled = false;
let githubToken = '';
let githubRepo = '';

/**
 * Initialize GitHub backup connection
 */
function initGitHub() {
    githubToken = process.env.GITHUB_BACKUP_TOKEN;
    githubRepo = process.env.GITHUB_BACKUP_REPO;

    if (!githubToken || !githubRepo) {
        console.log('⚠️  GitHub backup disabled — missing environment variables');
        console.log('   Required: GITHUB_BACKUP_TOKEN, GITHUB_BACKUP_REPO');
        return false;
    }

    githubEnabled = true;
    console.log(`🐙 GitHub backup enabled — repo: ${githubRepo}`);
    return true;
}

/**
 * GitHub API request helper
 */
async function ghAPI(method, endpoint, data = null) {
    const config = {
        method,
        url: `${GITHUB_API}${endpoint}`,
        headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'ArtevaMaison-Backup'
        }
    };
    if (data) config.data = data;
    return axios(config);
}

/**
 * Upload a local backup folder to GitHub
 * Each backup becomes a folder like: backups/backup-2026-04-30T04-00-00/
 * Files are uploaded as base64-encoded content via GitHub Contents API
 * 
 * @param {string} backupFolderPath - Local path to backup folder
 * @param {string} backupName - Name of the backup
 * @returns {boolean} Success status
 */
async function uploadBackupToGitHub(backupFolderPath, backupName) {
    if (!githubEnabled) {
        console.log('⚠️  GitHub not configured, skipping cloud upload');
        return false;
    }

    try {
        const files = fs.readdirSync(backupFolderPath).filter(f => f.endsWith('.json'));
        let uploadedCount = 0;

        for (const file of files) {
            const localFilePath = path.join(backupFolderPath, file);
            const content = fs.readFileSync(localFilePath);
            const base64Content = content.toString('base64');
            const ghPath = `backups/${backupName}/${file}`;

            // Check if file already exists (to get sha for update)
            let sha = null;
            try {
                const existing = await ghAPI('GET', `/repos/${githubRepo}/contents/${ghPath}`);
                sha = existing.data.sha;
            } catch (e) {
                // File doesn't exist yet — that's fine
            }

            const payload = {
                message: `Backup: ${backupName} — ${file}`,
                content: base64Content,
                branch: 'main'
            };
            if (sha) payload.sha = sha;

            await ghAPI('PUT', `/repos/${githubRepo}/contents/${ghPath}`, payload);
            uploadedCount++;
        }

        console.log(`🐙 Uploaded ${uploadedCount} files to GitHub: backups/${backupName}/`);
        return true;
    } catch (error) {
        console.error(`❌ GitHub upload failed for ${backupName}:`, error.response?.data?.message || error.message);
        return false;
    }
}

/**
 * List all backups stored in GitHub
 * @returns {Array} List of backup objects
 */
async function listGitHubBackups() {
    if (!githubEnabled) return [];

    try {
        const response = await ghAPI('GET', `/repos/${githubRepo}/contents/backups`);

        if (!Array.isArray(response.data)) return [];

        const backups = response.data
            .filter(item => item.type === 'dir' && item.name.startsWith('backup-'))
            .map(item => ({
                name: item.name,
                source: 'github',
                timestamp: item.name.replace('backup-', '').replace(/-/g, (m, i) => {
                    // Convert backup-2026-04-30T04-00-00 back to ISO-ish format for sorting
                    return i < 15 ? m : ':';
                }),
                url: item.html_url
            }))
            .sort((a, b) => b.name.localeCompare(a.name));

        return backups;
    } catch (error) {
        if (error.response?.status === 404) {
            // backups folder doesn't exist yet
            return [];
        }
        console.error('❌ Failed to list GitHub backups:', error.response?.data?.message || error.message);
        return [];
    }
}

/**
 * Download a backup from GitHub to local directory
 * @param {string} backupName - Name of backup to download
 * @param {string} localDir - Local directory to download to
 * @returns {boolean} Success status
 */
async function downloadBackupFromGitHub(backupName, localDir) {
    if (!githubEnabled) return false;

    try {
        const destFolder = path.join(localDir, backupName);
        if (!fs.existsSync(destFolder)) {
            fs.mkdirSync(destFolder, { recursive: true });
        }

        // List files in the backup folder
        const response = await ghAPI('GET', `/repos/${githubRepo}/contents/backups/${backupName}`);

        if (!Array.isArray(response.data)) {
            console.error('Unexpected response from GitHub');
            return false;
        }

        for (const file of response.data) {
            if (file.name.endsWith('.json')) {
                // Download file content
                const fileResponse = await ghAPI('GET', `/repos/${githubRepo}/contents/backups/${backupName}/${file.name}`);
                const content = Buffer.from(fileResponse.data.content, 'base64').toString('utf8');
                const destPath = path.join(destFolder, file.name);
                fs.writeFileSync(destPath, content);
            }
        }

        console.log(`🐙 Downloaded backup from GitHub: ${backupName}`);
        return true;
    } catch (error) {
        console.error(`❌ GitHub download failed for ${backupName}:`, error.response?.data?.message || error.message);
        return false;
    }
}

/**
 * Delete a backup from GitHub
 * @param {string} backupName - Name of backup to delete
 */
async function deleteGitHubBackup(backupName) {
    if (!githubEnabled) return;

    try {
        // List all files in the backup folder
        const response = await ghAPI('GET', `/repos/${githubRepo}/contents/backups/${backupName}`);

        if (!Array.isArray(response.data)) return;

        // Delete each file (GitHub requires individual file deletion)
        for (const file of response.data) {
            await ghAPI('DELETE', `/repos/${githubRepo}/contents/backups/${backupName}/${file.name}`, {
                message: `Cleanup: remove old backup ${backupName}/${file.name}`,
                sha: file.sha,
                branch: 'main'
            });
        }

        console.log(`🗑️  Deleted GitHub backup: ${backupName}`);
    } catch (error) {
        if (error.response?.status === 404) return; // Already deleted
        console.error(`❌ Failed to delete GitHub backup ${backupName}:`, error.response?.data?.message || error.message);
    }
}

/**
 * Clean old GitHub backups, keeping only the most recent N
 * @param {number} keepCount - Number of backups to keep (default: 7)
 */
async function cleanOldGitHubBackups(keepCount = 7) {
    if (!githubEnabled) return;

    try {
        const backups = await listGitHubBackups();

        if (backups.length <= keepCount) {
            console.log(`🐙 GitHub has ${backups.length} backup(s), keeping all (limit: ${keepCount})`);
            return;
        }

        const toDelete = backups.slice(keepCount);
        for (const backup of toDelete) {
            await deleteGitHubBackup(backup.name);
        }

        console.log(`🐙 Cleaned ${toDelete.length} old GitHub backup(s), kept ${keepCount}`);
    } catch (error) {
        console.error('❌ Failed to clean old GitHub backups:', error.message);
    }
}

/**
 * Check if GitHub backup is configured
 */
function isGitHubEnabled() {
    return githubEnabled;
}

// Initialize on module load
initGitHub();

module.exports = {
    initGitHub,
    uploadBackupToGitHub,
    listGitHubBackups,
    downloadBackupFromGitHub,
    deleteGitHubBackup,
    cleanOldGitHubBackups,
    isGitHubEnabled
};
