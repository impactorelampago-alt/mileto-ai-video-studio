import fs from 'fs';
import path from 'path';

const root = process.argv[2] || process.cwd();
const folderSizes = new Map();
const largeFiles = [];

function walk(dir, depth) {
    let size = 0;
    try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
            // Skip .git to match standard size reporting
            if (file.name === '.git') continue;

            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                const dirSize = walk(fullPath, depth + 1);
                size += dirSize;
                // Store sizes for depth 1 and 2 (relative to root)
                if (depth < 2) {
                    folderSizes.set(fullPath, dirSize);
                }
            } else {
                try {
                    const st = fs.statSync(fullPath);
                    size += st.size;
                    if (st.size > 50 * 1024 * 1024) {
                        // > 50MB
                        largeFiles.push({ path: fullPath, size: st.size });
                    }
                } catch (e) {
                    // Ignore stat errors (e.g., broken symlinks or permissions)
                }
            }
        }
    } catch (e) {
        // Ignore read errors
    }
    return size;
}

console.log('Calculating sizes, please wait (this might take a minute on Windows)...');
const totalSize = walk(root, 0);

console.log('\n--- TOP FOLDERS (Depth 1 & 2) ---');
const sortedFolders = [...folderSizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
for (const [p, s] of sortedFolders) {
    console.log(`${(s / 1024 / 1024).toFixed(2).padStart(10, ' ')} MB\t${p}`);
}
console.log(`\nTOTAL PROJECT SIZE (excluding .git): ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

console.log('\n--- TOP FILES > 50MB ---');
largeFiles
    .sort((a, b) => b.size - a.size)
    .slice(0, 80)
    .forEach((f) => {
        console.log(`${(f.size / 1024 / 1024).toFixed(2).padStart(10, ' ')} MB\t${f.path}`);
    });
