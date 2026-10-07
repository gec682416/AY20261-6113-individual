import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider, ContractFactory, parseEther, ZeroAddress} from 'ethers';
import {compile} from '../scripts/compile.mjs';

const helper=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
interface IHub {function withdraw(uint256) external;}
contract Receiver {
 IHub hub; uint256 id; bool public blocked; bool public reject;
 constructor(address h, bool r) {hub=IHub(h); reject=r;}
 function claim(uint256 i) external {id=i; hub.withdraw(i);}
 receive() external payable {
   require(!reject,"Reject funds");
   try hub.withdraw(id) {blocked=false;} catch {blocked=true;}
 }
}`;
const compiled=compile({'Receiver.sol':{content:helper}});
const artifact=compiled['CharityHub.sol'].CharityHub;
const server=ganache.provider({logging:{quiet:true},chain:{chainId:31337,hardfork:'shanghai'},wallet:{totalAccounts:4}});
const provider=new BrowserProvider(server,undefined,{cacheTimeout:-1});
const owner=await provider.getSigner(0), donor=await provider.getSigner(1), beneficiary=await provider.getSigner(2);
const addresses=await Promise.all([owner,donor,beneficiary].map(x=>x.getAddress()));
const deploy=async()=>{const hub=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,owner).deploy(); await hub.waitForDeployment(); return hub;};
const send=async promise=>(await promise).wait();
async function rejects(action) {await assert.rejects(async()=>{const tx=await action(); if(tx.wait) await tx.wait();});}

test('CharityHub financial and security integration',async t=>{
  await t.test('constructor seeds three demo campaigns and immutable owner',async()=>{
    const h=await deploy(); assert.equal(await h.owner(),addresses[0]); assert.equal(await h.APP_ID(),'common-good-v1');
    const rows=await h.getCampaigns(); assert.equal(rows.length,3); assert.equal(rows[0].beneficiary,addresses[0]);
    assert.equal(rows[0].raised,0n); assert.equal(rows[0].goal,parseEther('0.1'));
  });
  await t.test('donation records exact wei, donor accounting and public event',async()=>{
    const h=await deploy(); const receipt=await send(h.connect(donor).donate(0,{value:parseEther('0.007')}));
    assert.equal((await h.getCampaign(0)).raised,parseEther('0.007')); assert.equal(await h.totalDonated(),parseEther('0.007'));
    assert.equal(await h.donatedTo(0,addresses[1]),parseEther('0.007')); assert.equal(await h.donorCount(addresses[1]),1n);
    const evt=receipt.logs.map(l=>{try{return h.interface.parseLog(l);}catch{return null;}}).find(x=>x?.name==='ActivityRecorded');
    assert.equal(evt.args.actor,addresses[1]); assert.equal(evt.args.amount,parseEther('0.007')); assert.equal(evt.args.kind,0n);
  });
  await t.test('zero, excessive and unknown-campaign donations revert',async()=>{
    const h=await deploy(); for(const [id,value] of [[0,0n],[0,parseEther('1.000000000000000001')],[99,1n]]) await rejects(()=>h.connect(donor).donate(id,{value}));
    assert.equal(await h.totalDonated(),0n);
  });
  await t.test('owner-only campaign creation and pause; validates all parameters',async()=>{
    const h=await deploy(); const good=['New community cause','A specific purpose for this campaign.',addresses[2],parseEther('0.2'),30];
    await rejects(()=>h.connect(donor).createCampaign(...good)); await rejects(()=>h.connect(donor).setPaused(0,true));
    for(const [index,bad] of [[0,'x'],[0,'x'.repeat(65)],[1,'short'],[1,'x'.repeat(241)],[2,ZeroAddress],[2,await h.getAddress()],[3,0n],[3,parseEther('101')],[4,0],[4,366]]) {
      const args=[...good]; args[index]=bad; await rejects(()=>h.createCampaign(...args));
    }
    await send(h.createCampaign(...good)); assert.equal((await h.getCampaigns()).length,4); assert.equal((await h.getCampaign(3)).beneficiary,addresses[2]);
  });
  await t.test('paused donations blocked; withdrawals remain possible',async()=>{
    const h=await deploy(); await send(h.connect(donor).donate(0,{value:1000n})); await send(h.setPaused(0,true));
    await rejects(()=>h.connect(donor).donate(0,{value:1n})); await send(h.withdraw(0)); assert.equal(await h.totalWithdrawn(),1000n);
    await send(h.setPaused(0,false)); await send(h.connect(donor).donate(0,{value:1n}));
  });
  await t.test('deadline blocks new donations but preserves beneficiary withdrawal',async()=>{
    const h=await deploy(); await send(h.connect(donor).donate(0,{value:77n}));
    await server.request({method:'evm_increaseTime',params:[181*86400]}); await server.request({method:'evm_mine',params:[]});
    await rejects(()=>h.connect(donor).donate(0,{value:1n})); await send(h.withdraw(0)); assert.equal(await h.totalWithdrawn(),77n);
  });
  await t.test('only beneficiary withdraws; administrator cannot take another campaign balance',async()=>{
    const h=await deploy(); await send(h.createCampaign('Student materials','Supply textbooks and learning materials.',addresses[2],parseEther('0.1'),30));
    await send(h.connect(donor).donate(3,{value:parseEther('0.006')}));
    await rejects(()=>h.withdraw(3)); await rejects(()=>h.connect(donor).withdraw(3));
    const before=BigInt(await server.request({method:'eth_getBalance',params:[addresses[2],'latest']}));
    const r=await send(h.connect(beneficiary).withdraw(3));
    const after=BigInt(await server.request({method:'eth_getBalance',params:[addresses[2],'latest']}));
    assert.equal(after-before+r.gasUsed*r.gasPrice,parseEther('0.006'));
    assert.equal((await h.getCampaign(3)).withdrawn,parseEther('0.006')); await rejects(()=>h.connect(beneficiary).withdraw(3));
  });
  await t.test('goal is a target; overfunding and subsequent donations after payout allowed',async()=>{
    const h=await deploy(); await send(h.connect(donor).donate(0,{value:parseEther('0.2')})); await send(h.withdraw(0));
    await send(h.connect(donor).donate(0,{value:123n})); await send(h.withdraw(0));
    assert.equal(await h.totalDonated(),parseEther('0.2')+123n); assert.equal(await h.totalWithdrawn(),await h.totalDonated());
  });
  await t.test('direct ETH transfer and unknown selector rejected',async()=>{
    const h=await deploy(); await rejects(()=>donor.sendTransaction({to:h.target,value:1n})); await rejects(()=>donor.sendTransaction({to:h.target,data:'0x12345678',value:1n}));
  });
  await t.test('global and personal reverse history paginate without duplicate records',async()=>{
    const h=await deploy(); await send(h.connect(donor).donate(0,{value:1n})); await send(h.connect(beneficiary).donate(1,{value:2n})); await send(h.withdraw(0));
    const page=await h.getHistory(0,2,ZeroAddress); assert.deepEqual(page.records.map(r=>r.id),[2n,1n]); assert.equal(page.hasMore,true);
    const older=await h.getHistory(page.nextCursor,2,ZeroAddress); assert.deepEqual(older.records.map(r=>r.id),[0n]); assert.equal(older.hasMore,false);
    const personal=await h.getHistory(0,10,addresses[1]); assert.equal(personal.records.length,1); assert.equal(personal.records[0].actor,addresses[1]);
    for(const [cursor,limit] of [[99,10],[0,0],[0,21]]) await assert.rejects(h.getHistory(cursor,limit,ZeroAddress));
  });
  await t.test('reentrant beneficiary cannot withdraw twice',async()=>{
    const h=await deploy(); const a=compiled['Receiver.sol'].Receiver;
    const receiver=await new ContractFactory(a.abi,a.evm.bytecode.object,owner).deploy(h.target,false); await receiver.waitForDeployment();
    await send(h.createCampaign('Guard test campaign','Local security test receiver campaign.',receiver.target,1000n,1)); await send(h.connect(donor).donate(3,{value:300n}));
    await send(receiver.claim(3)); assert.equal(await receiver.blocked(),true); assert.equal(await h.totalWithdrawn(),300n);
    assert.equal(BigInt(await server.request({method:'eth_getBalance',params:[receiver.target,'latest']})),300n);
  });
  await t.test('reverting beneficiary rolls back balance and history changes',async()=>{
    const h=await deploy(); const a=compiled['Receiver.sol'].Receiver;
    const receiver=await new ContractFactory(a.abi,a.evm.bytecode.object,owner).deploy(h.target,true); await receiver.waitForDeployment();
    await send(h.createCampaign('Rejection test','Local security test rejecting receiver.',receiver.target,1000n,1)); await send(h.connect(donor).donate(3,{value:400n}));
    await rejects(()=>receiver.claim(3)); assert.equal(await h.totalWithdrawn(),0n); assert.equal((await h.getCampaign(3)).withdrawn,0n);
    assert.equal((await h.getOverview()).activityCount,1n);
  });
  await server.disconnect();
});
