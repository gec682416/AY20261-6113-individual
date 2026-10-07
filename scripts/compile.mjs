import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import solc from 'solc';
export function compile(extra = {}) {
  const sources = {'CharityHub.sol':{content:readFileSync(new URL('../contracts/CharityHub.sol', import.meta.url),'utf8')}, ...extra};
  const output = JSON.parse(solc.compile(JSON.stringify({language:'Solidity', sources,
    settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  const errors = (output.errors || []).filter(e=>e.severity==='error');
  if(errors.length) throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
  return output.contracts;
}
if(process.argv[1]?.endsWith('scripts/compile.mjs')) {
  const c = compile()['CharityHub.sol'].CharityHub;
  writeFileSync('contracts/CharityHub.abi.json',JSON.stringify(c.abi,null,2)+'\n');
  mkdirSync('artifacts',{recursive:true});
  writeFileSync('artifacts/CharityHub.json',JSON.stringify(c,null,2));
  console.log(`Solidity 0.8.24 / Paris / optimizer 200: ${c.evm.bytecode.object.length/2} creation bytes. ABI saved.`);
}
