const fs = require('fs');
fs.rmSync('www', { recursive: true, force: true });
fs.cpSync('public', 'www', { recursive: true });
console.log('public -> www done');
