const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function (file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            results.push(file);
        }
    });
    return results;
}

const targetDir = path.join(__dirname, 'src');
const files = walk(targetDir);

let count = 0;
files.forEach((file) => {
    let content = fs.readFileSync(file, 'utf8');

    // We are looking for the literal string that has the backslashes
    const searchStr1 = "\\'http://localhost:3301\\'";
    const replaceStr1 = "'http://localhost:3301'";

    const searchStr2 = "\\'http://localhost:3000\\'";
    const replaceStr2 = "'http://localhost:3000'";

    const searchStr3 = "\\'http://localhost:3000/api\\'";
    const replaceStr3 = "'http://localhost:3000/api'";

    let modified = false;

    if (content.includes(searchStr1)) {
        content = content.replace(new RegExp(searchStr1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceStr1);
        modified = true;
    }
    if (content.includes(searchStr2)) {
        content = content.replace(new RegExp(searchStr2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceStr2);
        modified = true;
    }
    if (content.includes(searchStr3)) {
        content = content.replace(new RegExp(searchStr3.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceStr3);
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('Fixed', file);
        count++;
    }
});

console.log('Done! Files modified:', count);
