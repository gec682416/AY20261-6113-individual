// Node DOM + a synthetic EIP-1193 wallet backed only by disposable localhost Ganache.
// This never connects to a real browser wallet or a public network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import * as ethers from 'ethers';

test('local UI controller: connect, validate, donate, create, withdraw, reject and recover receipt',
  {skip:process.env.LOCAL_UI_TEST!=='1',timeout:60000},async()=>{
    const origin='http://127.0.0.1:5005';
    const cfg=await (await fetch(origin+'/api/config')).json();
    assert.equal(cfg.local,true,'UI integration is allowed only on the local chain'); assert.equal(cfg.chainId,31337);
    const rpc=new ethers.JsonRpcProvider('http://127.0.0.1:8545',undefined,{cacheTimeout:-1});
    const accounts=await rpc.send('eth_accounts',[]); let current=accounts[0],rejectOnce=false,receiptOffline=false;
    const listeners=new Map();
    const wallet={isMetaMask:true,on:(event,fn)=>listeners.set(event,fn),request:async({method,params=[]})=>{
      if(method==='eth_requestAccounts' || method==='eth_accounts') return [current];
      if(method==='eth_chainId') return '0x7a69';
      if(method==='eth_sendTransaction' && rejectOnce) {rejectOnce=false; const error=new Error('User rejected'); error.code=4001; throw error;}
      return rpc.send(method,params);
    }};
    const html=readFileSync(new URL('../templates/index.html',import.meta.url),'utf8');
    const dom=new JSDOM(html,{url:origin,runScripts:'outside-only'}); const w=dom.window,doc=w.document;
    w.ethers=ethers; w.ethereum=wallet; w.TextEncoder=TextEncoder; w.AbortController=AbortController;
    w.fetch=(url,options)=>{
      if(receiptOffline && String(url).startsWith('/api/receipt/')) return Promise.resolve(new Response(JSON.stringify({error:'Simulated receipt RPC outage'}),{status:503,headers:{'Content-Type':'application/json'}}));
      return fetch(new URL(url,origin),options);
    };
    const $=id=>doc.getElementById(id);
    const until=async check=>{for(let i=0;i<250;i++){if(check())return; await new Promise(r=>setTimeout(r,80));} throw new Error('UI timeout: '+$('transaction').textContent+' / '+$('manage-transaction').textContent+' / '+$('notice').textContent);};
    const submit=id=>$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    try {
      w.eval(readFileSync(new URL('../static/app.js',import.meta.url),'utf8'));
      await until(()=>$('campaign-list').querySelector('.campaign-card'));
      assert.equal($('donate').disabled,true); $('connect').click();
      await until(()=>!$('donate').disabled && !$('admin-controls').hidden);
      const before=BigInt((await (await fetch(origin+'/api/state?fresh=1')).json()).totalDonatedWei);
      $('amount').value='0'; $('consent').checked=true; submit('donation-form');
      await until(()=>!$('donation-error').hidden); assert.match($('donation-error').textContent,/over 0/);
      $('amount').value='0.002'; submit('donation-form');
      await until(()=>$('transaction').textContent.includes('confirmed in block') && !$('donate').disabled);
      const after=await (await fetch(origin+'/api/state?fresh=1')).json(); assert.equal(BigInt(after.totalDonatedWei)-before,ethers.parseEther('0.002'));
      assert.ok(doc.querySelectorAll('#history-body tr').length>=4);
      $('create-title').value='Wallet controller test'; $('create-description').value='Local integration campaign for a different beneficiary.';
      $('create-beneficiary').value=accounts[1]; $('create-goal').value='0.02'; $('create-days').value='20'; submit('create-form');
      await until(()=>$('manage-transaction').textContent.includes('Campaign creation') && $('manage-transaction').textContent.includes('confirmed in block') && !$('donate').disabled);
      const id=Number($('campaign-select').options[$('campaign-select').options.length-1].value);
      $('campaign-select').value=String(id); $('campaign-select').dispatchEvent(new w.Event('change'));
      $('amount').value='0.003'; submit('donation-form');
      await until(()=>$('transaction').textContent.includes('Contribution · Wallet controller test confirmed') && !$('donate').disabled);
      current=accounts[1]; listeners.get('accountsChanged')([current]);
      const payout=()=>doc.querySelector(`#beneficiary-actions [data-campaign-id="${id}"] button`);
      await until(()=>$('admin-controls').hidden && payout() && !payout().disabled);
      payout().click();
      await until(()=>$('manage-transaction').textContent.includes('Withdrawal · Wallet controller test confirmed') && !$('donate').disabled);
      const state=await (await fetch(origin+'/api/state?fresh=1')).json(); assert.equal(state.campaigns[id].availableWei,'0'); assert.equal(state.campaigns[id].withdrawnWei,'3000000000000000');
      $('my-history').click(); await until(()=>$('history-body').textContent.includes('Payout'));
      rejectOnce=true; $('amount').value='0.001'; submit('donation-form');
      await until(()=>$('transaction').textContent.includes('declined') && !$('donate').disabled);
      receiptOffline=true; submit('donation-form');
      await until(()=>$('transaction').textContent.includes('confirmation could not be checked'));
      assert.equal($('donate').disabled,true); assert.ok(w.localStorage.length>0);
      receiptOffline=false; [...$('transaction').querySelectorAll('button')].find(b=>b.textContent==='Check confirmation').click();
      await until(()=>$('transaction').textContent.includes('confirmed in block') && !$('donate').disabled);
      assert.equal(w.localStorage.length,0);
      $('disconnect').click();
      const ownerShort=`${accounts[0].slice(0,6)}…${accounts[0].slice(-4)}`;
      await until(()=>$('manage').hidden && $('my-total').textContent==='Connect a wallet' && $('history-body').textContent.toLowerCase().includes(ownerShort.toLowerCase()));
      assert.equal($('donate').disabled,true);
    } finally {dom.window.close(); await rpc.destroy();}
  });
