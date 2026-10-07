import {copyFileSync} from 'node:fs';
copyFileSync('node_modules/ethers/dist/ethers.umd.min.js','static/vendor/ethers.umd.min.js');
copyFileSync('node_modules/ethers/LICENSE.md','static/vendor/ethers-LICENSE.md');
console.log('Browser ethers library bundled; Render only needs Python.');
