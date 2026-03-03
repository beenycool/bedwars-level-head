const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'src', 'routes', 'admin.ts');
let code = fs.readFileSync(target, 'utf-8');

const regex = /if \(typeof identifier === 'string'\) \{\s*const normalizedIdentifier = identifier\.trim\(\);\s*if \(normalizedIdentifier\.length > 0\) \{/m;

const replacement = `if (typeof identifier === 'string' && identifier.trim().length > 0) {\n      const normalizedIdentifier = identifier.trim();`;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync(target, code, 'utf-8');
    console.log("Replaced block successfully");
} else {
    console.log("Could not find block to replace.");
}
