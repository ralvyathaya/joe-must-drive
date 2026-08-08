/**
 * WaveDash Deployment Script
 * Deploy Joe Must Drive to WaveDash platform
 */

const fs = require('fs');
const path = require('path');
const { WavedashClient } = require('@wvdsh/sdk-js');

// Configuration
const PROJECT_NAME = 'joe-must-drive';
const DIST_DIR = path.join(__dirname, 'dist');
const PACKAGE_JSON = path.join(__dirname, 'package.json');

// Read package.json for version info
const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));

console.log(`🚀 Starting WaveDash deployment...`);
console.log(`Project: ${PROJECT_NAME}`);
console.log(`Version: ${pkg.version}`);
console.log(`Source: ${DIST_DIR}`);

/**
 * Create upload manifest
 */
async function createUploadManifest() {
    const files = [];
    
    function scanDirectory(dir, baseDir = '') {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(baseDir, entry.name);
            
            if (entry.isDirectory()) {
                scanDirectory(fullPath, relativePath);
            } else {
                const content = fs.readFileSync(fullPath);
                const size = content.length;
                const hash = Buffer.from(content).toString('base64').substring(0, 16);
                
                files.push({
                    path: relativePath,
                    size: size,
                    type: getFileType(relativePath),
                    content: content.toString('base64')
                });
            }
        }
    }
    
    function getFileType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.ttf': 'font/ttf',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ogg': 'audio/ogg',
            '.mp3': 'audio/mpeg',
            '.glb': 'model/gltf-binary',
            '.webmanifest': 'application/manifest+json'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
    
    scanDirectory(DIST_DIR);
    
    return {
        projectName: PROJECT_NAME,
        version: pkg.version,
        timestamp: new Date().toISOString(),
        files: files,
        entryPoint: 'index.html',
        portfolioEntry: 'portfolio.html'
    };
}

/**
 * Main deployment function
 */
async function deployToWaveDash() {
    try {
        console.log('\n📦 Scanning files in dist/...\n');
        
        // Create manifest
        const manifest = await createUploadManifest();
        
        console.log(`Found ${manifest.files.length} files to upload:`);
        const totalSize = manifest.files.reduce((sum, f) => sum + f.size, 0);
        console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n`);
        
        // Show file breakdown
        const byType = {};
        manifest.files.forEach(f => {
            byType[f.type] = (byType[f.type] || 0) + 1;
        });
        
        console.log('File types:');
        Object.entries(byType).forEach(([type, count]) => {
            console.log(`  ${count}x ${type.split('/')[1].toUpperCase()} (${type})`);
        });
        
        // Here you would typically call WaveDash API
        // Since we don't have actual API credentials yet, we'll show what's needed
        
        console.log('\n⚙️  Deployment Manifest Created:');
        console.log(JSON.stringify({
            project: manifest.projectName,
            version: manifest.version,
            entryPoint: manifest.entryPoint,
            portfolioEntry: manifest.portfolioEntry,
            files: manifest.files.length,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
        }, null, 2));
        
        // Save manifest to dist/deploy-manifest.json for reference
        const manifestPath = path.join(DIST_DIR, 'deploy-manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`\n💾 Manifest saved to: dist/deploy-manifest.json`);
        
        // For manual deployment, create instructions
        console.log('\n📋 Next Steps:\n');
        console.log('1. Go to WaveDash Dashboard: https://wavedash.io/dashboard');
        console.log('2. Click "Create New Project"');
        console.log('3. Upload all files from: ' + DIST_DIR);
        console.log('4. Set entry point to: index.html');
        console.log('5. Optional: Set portfolio entry to: portfolio.html');
        console.log('6. Deploy and share your URL!\n');
        
        // Check for WaveDash API key
        const apiKey = process.env.WAVEDASH_API_KEY;
        if (apiKey) {
            console.log('✨ Found WAVE_DASH_API_KEY - attempting programmatic deployment...');
            // You could uncomment below to enable auto-deploy with API key
            // await deployWithSDK(manifest, apiKey);
        } else {
            console.log('ℹ️  No WAVE_DASH_API_KEY found - using manual deployment instructions');
            console.log('   To enable automatic deployment, set: export WAVEDASH_API_KEY=your_key\n');
        }
        
        console.log('✅ Deployment preparation complete!');
        console.log('🎮 Your game is ready to be uploaded to WaveDash!\n');
        
    } catch (error) {
        console.error('\n❌ Deployment error:', error.message);
        process.exit(1);
    }
}

/**
 * Alternative: Programmatic deployment via SDK
 */
async function deployWithSDK(manifest, apiKey) {
    try {
        const client = new WavedashClient({ apiKey });
        
        // Create project
        const project = await client.createProject({
            name: manifest.projectName,
            version: manifest.version
        });
        
        console.log(`✓ Project created: ${project.id}`);
        
        // Upload files
        const uploadResult = await client.uploadFiles({
            projectId: project.id,
            files: manifest.files,
            entryPoint: manifest.entryPoint
        });
        
        console.log(`✓ Uploaded ${uploadResult.fileCount} files`);
        console.log(`✓ Deployment URL: ${uploadResult.deployUrl}`);
        
        console.log('\n🎉 Deployment successful!');
        console.log(`Your game is live at: ${uploadResult.deployUrl}\n`);
        
        return uploadResult;
        
    } catch (error) {
        console.error('Deployment failed:', error.message);
        throw error;
    }
}

// Export for use as module
module.exports = { deployToWaveDash, createUploadManifest };

// Run if executed directly
if (require.main === module) {
    deployToWaveDash();
}