const fs = require('fs');
const path = require('path');

// 1. Ensure destination directory exists
if (!fs.existsSync('src/features/insert-toc')) {
    fs.mkdirSync('src/features/insert-toc', { recursive: true });
}

// 2. Move original directories
const dirs = ['index', 'outline', 'notebook'];
dirs.forEach(d => {
    const src = `src/features/${d}`;
    const dest = `src/features/insert-toc/${d}`;
    if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
    }
});

// 3. Process files to update import paths
function processDir(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.svelte')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            // Safely replace relative import paths that point outside the folder
            const newContent = content.replace(/from "\.\.\/\.\.\//g, 'from "../../../');
            if (content !== newContent) {
                fs.writeFileSync(fullPath, newContent, 'utf8');
            }
        }
    });
}

processDir('src/features/insert-toc');
console.log('UTF-8 Safe restoration and replacement complete.');
