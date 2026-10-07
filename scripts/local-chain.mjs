// Local-only fixtures. Ganache owns disposable accounts; never use these on a public network.
import ganache from 'ganache';
import {JsonRpcProvider,ContractFactory,parseEther} from 'ethers';
import {mkdirSync,writeFileSync} from 'node:fs';
import {compile} from './compile.mjs';
const server=ganache.server({logging:{quiet:true},chain:{chainId:31337},wallet:{totalAccounts:4}});
await server.listen(8545,'127.0.0.1');
const provider=new JsonRpcProvider('http://127.0.0.1:8545');
const owner=await provider.getSigner(0),donor=await provider.getSigner(1);
const artifact=compile()['CharityHub.sol'].CharityHub;
const hub=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,owner).deploy(); await hub.waitForDeployment();
for(const [id,amount] of [[0,'0.007'],[1,'0.004'],[0,'0.003']]) await (await hub.connect(donor).donate(id,{value:parseEther(amount)})).wait();
await (await hub.withdraw(0)).wait();
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/local-address.json',JSON.stringify({address:hub.target,owner:await owner.getAddress(),donor:await donor.getAddress(),chainId:31337},null,2));
console.log(`LOCAL ONLY: contract ${hub.target}; 3 donations and 1 withdrawal. See artifacts/local-address.json.`);
console.log('RPC http://127.0.0.1:8545. Keep this process running for local UI verification.');
process.on('SIGINT',async()=>{await server.close(); process.exit(0);});
