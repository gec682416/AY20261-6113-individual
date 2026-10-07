/* Read through Flask; sign exclusively in the connected wallet. No private keys. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = window.ethers;
  const s = {config:null, data:null, account:null, wallet:null, selected:null, busy:false,
    reading:false, historyBusy:false, mine:false, cursor:0, pending:null, providers:[]};
  const short = value => `${value.slice(0,6)}…${value.slice(-4)}`;
  const same = (a,b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const eth = wei => E.formatEther(BigInt(wei)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/,'');
  const date = stamp => new Date(stamp * 1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const node = (tag, text, cls) => {const n = document.createElement(tag); if(text !== undefined) n.textContent=text; if(cls) n.className=cls; return n;};
  const message = (text, error=false) => {$('notice').textContent=text; $('notice').className=`notice${error?' error':''}`; $('notice').hidden=!text;};
  const fieldError = (id,text='') => {$(id).textContent=text; $(id).hidden=!text;};
  const pendingKey = () => `common-good:pending:${s.config.chainId}:${s.config.contractAddress.toLowerCase()}`;
  function storePending(value) {
    s.pending=value;
    try {if(value) localStorage.setItem(pendingKey(), JSON.stringify(value)); else localStorage.removeItem(pendingKey());} catch { /* Storage may be unavailable in private browsing. */ }
  }
  async function api(path) {
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),45000);
    try {
      const response=await fetch(path,{signal:ctrl.signal,cache:'no-store'});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error || 'The server could not complete the request.');
      return body;
    } catch(error) {if(error.name==='AbortError') throw new Error('Blockchain read timed out. Refresh to try again.'); throw error;}
    finally {clearTimeout(timer);}
  }
  function friendly(error) {
    if(error.code===4001 || error.code==='ACTION_REJECTED' || error.info?.error?.code===4001) return 'You declined the wallet request. No new transaction was submitted by this action.';
    if(error.code==='INSUFFICIENT_FUNDS') return 'Your wallet needs enough test ETH for both the contribution and gas.';
    return error.reason || error.shortMessage || error.message || 'The wallet request failed. Check the network and try again.';
  }
  function link(text, path, fallback) {
    if(!s.config.explorerUrl) return node('span',fallback || text);
    const a=node('a',text); a.href=s.config.explorerUrl+path; a.target='_blank'; a.rel='noopener noreferrer'; return a;
  }
  function amount(value,max) {
    const v=value.trim();
    if(!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(v)) throw new Error('Enter a decimal ETH amount with up to 18 decimal places.');
    const wei=E.parseEther(v);
    if(wei<=0n || wei>E.parseEther(String(max))) throw new Error(`Enter an amount over 0 and at most ${max} test ETH.`);
    return wei;
  }
  function buttons() {
    const campaign=s.data?.campaigns.find(c=>c.id===s.selected);
    const blocked=s.busy || !!s.pending || !s.data;
    $('connect').disabled=s.busy;
    $('connect').textContent=s.account ? short(s.account) : 'Connect wallet ↗';
    $('disconnect').hidden=!s.account; $('my-history').disabled=!s.account;
    $('campaign-select').disabled=!s.data || s.busy;
    $('donate').disabled=blocked || !s.account || !campaign?.active;
    $('donate').textContent=s.busy?'Waiting for transaction…':s.pending?'Transaction pending · check below':!s.data?'Refresh to load campaigns':!s.account?'Connect wallet to donate ↗':!campaign?.active?'Campaign is not accepting donations':'Donate on Sepolia ↗';
    if(s.config?.local && !blocked && s.account && campaign?.active) $('donate').textContent='Donate on local test chain ↗';
    $('create-submit').disabled=blocked;
    document.querySelectorAll('[data-write]').forEach(b=>b.disabled=blocked || b.dataset.unavailable==='true');
  }
  function select(id) {
    s.selected=Number(id);
    const c=s.data?.campaigns.find(x=>x.id===s.selected);
    if(!c) return;
    $('campaign-select').value=String(c.id);
    $('selected-description').textContent=c.description;
    $('beneficiary').replaceChildren(link(short(c.beneficiary),`/address/${c.beneficiary}`));
    $('beneficiary').title=c.beneficiary;
    $('campaign-end').textContent=date(c.deadline);
    document.querySelectorAll('.campaign-card').forEach(card=>card.classList.toggle('selected',Number(card.dataset.id)===c.id));
    buttons();
  }
  const artwork = [
    '<path d="M24 39h64v48H24zM32 39V28h48v11M38 56h12v16H38zM62 56h12v16H62zM28 83h56M40 22v-9m16 9V9m16 13v-9"/>',
    '<path d="M20 30q18-9 36 0q18-9 36 0v49q-18-9-36 0q-18-9-36 0zM56 30v49M29 42l16-1M29 52l16-1M68 42l14-1M68 52l14-1M42 93h28"/>',
    '<path d="M20 53l36-29 36 29M29 48v40h54V48M47 88V65h18v23M46 40h20M56 30v20M46 70H34M78 70H66"/>'
  ];
  function renderCampaigns() {
    const cards=s.data.campaigns.map(c=>{
      const card=node('article',undefined,'campaign-card'); card.dataset.id=c.id;
      const art=node('div',undefined,'campaign-art'); art.dataset.theme=c.id%3;
      art.innerHTML=`<svg viewBox="0 0 112 112" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${artwork[c.id%3]}</svg>`;
      const content=node('div',undefined,'campaign-content');
      const meta=node('div',undefined,'campaign-meta'); meta.append(node('span',`CAUSE / ${String(c.id+1).padStart(2,'0')}`),node('span',c.paused?'Paused':c.active?'Accepting donations':'Ended'));
      content.append(meta,node('h3',c.title),node('p',c.description,'campaign-description'));
      const progress=node('div',undefined,'progress'); const bar=node('span');
      const ratio=BigInt(c.raisedWei)*10000n/BigInt(c.goalWei); bar.style.transform=`scaleX(${Math.min(Number(ratio),10000)/10000})`; progress.append(bar);
      progress.setAttribute('role','progressbar'); progress.setAttribute('aria-label',`${c.title} funding`); progress.setAttribute('aria-valuenow',Math.min(Number(ratio)/100,100)); progress.setAttribute('aria-valuemin','0'); progress.setAttribute('aria-valuemax','100');
      const funding=node('div',undefined,'funding-row'); funding.append(node('strong',`${eth(c.raisedWei)} ETH raised`),node('span',`of ${eth(c.goalWei)} ETH target`));
      const bottom=node('div',undefined,'campaign-bottom'); const choose=node('button','Choose cause ↗','text-button'); choose.type='button'; choose.addEventListener('click',()=>{select(c.id); $('amount').focus();});
      bottom.append(node('small',`${c.donationCount} contributions · ${eth(c.withdrawnWei)} ETH paid out`),choose);
      content.append(progress,funding,bottom); card.append(art,content); return card;
    });
    $('campaign-list').replaceChildren(...cards); $('campaign-list').setAttribute('aria-busy','false');
    $('campaign-select').replaceChildren(...s.data.campaigns.map(c=>{const option=node('option',c.title); option.value=c.id; return option;}));
    if(!s.data.campaigns.some(c=>c.id===s.selected)) s.selected=s.data.campaigns.find(c=>c.active)?.id ?? s.data.campaigns[0]?.id;
    select(s.selected);
  }
  function renderManage() {
    const own=s.data.campaigns.filter(c=>same(c.beneficiary,s.account));
    const admin=same(s.data.owner,s.account);
    $('manage').hidden=(!s.account || (!admin && !own.length)) && s.pending?.box!=='manage-transaction'; $('admin-controls').hidden=!admin;
    $('beneficiary-actions').replaceChildren(...own.map(c=>{
      const row=node('div',undefined,'manage-row'); row.dataset.campaignId=c.id; const title=node('div'); title.append(node('strong',c.title),node('p',`${eth(c.availableWei)} test ETH available to your wallet`,'helper'));
      const b=node('button','Withdraw available funds ↗','button outline'); b.dataset.write='true'; b.dataset.unavailable=String(BigInt(c.availableWei)===0n);
      b.addEventListener('click',()=>write('withdraw',[c.id], 'manage-transaction', `Withdrawal · ${c.title}`)); row.append(title,b); return row;
    }));
    $('pause-actions').replaceChildren(...(admin?s.data.campaigns.map(c=>{
      const row=node('div',undefined,'manage-row'); const b=node('button',c.paused?'Resume donations':'Pause donations','text-button'); b.dataset.write='true';
      b.addEventListener('click',()=>write('setPaused',[c.id,!c.paused], 'manage-transaction', `${c.paused?'Resume':'Pause'} · ${c.title}`));
      row.append(node('span',c.title),b); return row;
    }):[]));
    buttons();
  }
  async function refresh(fresh=false) {
    if(s.reading || !s.config) return;
    s.reading=true; const account=s.account;
    $('refresh').disabled=true;
    try {
      const query=new URLSearchParams(); if(account) query.set('account',account); if(fresh) query.set('fresh','1');
      const data=await api(`/api/state?${query}`);
      if(account!==s.account) return;
      s.data=data;
      $('total-raised').textContent=eth(data.totalDonatedWei); $('total-paid').textContent=eth(data.totalWithdrawnWei);
      $('total-count').textContent=data.donationCount; $('total-available').textContent=eth(data.availableWei);
      $('my-total').textContent=data.donor?`${eth(data.donor.totalWei)} test ETH`:'Connect a wallet';
      $('my-count').textContent=data.donor?`${data.donor.count} confirmed contributions`:'Your signing keys stay in MetaMask.';
      $('connection-status').textContent=s.config.local?'Local test chain':'Live on Sepolia'; $('connection-status').className='badge';
      $('data-note').textContent=`Read at block ${data.blockNumber.toLocaleString()}. Goals are targets; donations can exceed them.`;
      renderCampaigns(); renderManage();
      if($('notice').dataset.source==='read') {message(''); delete $('notice').dataset.source;}
    } catch(error) {
      if(account!==s.account) return;
      s.data=null; buttons(); $('manage').hidden=true;
      $('connection-status').textContent='Connection unavailable'; $('connection-status').className='badge error';
      $('campaign-list').setAttribute('aria-busy','false');
      $('data-note').textContent='Previously shown values, if any, may be stale. Financial actions are disabled until a successful refresh.';
      message(error.message,true); $('notice').dataset.source='read';
      if(!$('campaign-list').querySelector('.campaign-card')) $('campaign-list').replaceChildren(node('p','Campaigns could not be loaded. Check the deployment configuration and refresh.','empty-state'));
    } finally {s.reading=false; $('refresh').disabled=false; buttons(); if(account!==s.account) refresh(true);}
  }
  async function history(append=false) {
    if(s.historyBusy || !s.config) return;
    if(s.mine && !s.account) return;
    s.historyBusy=true; const account=s.mine?s.account:null; const mode=s.mine;
    $('load-more').disabled=true; $('history-message').textContent='Reading on-chain history…';
    try {
      const query=new URLSearchParams({cursor:String(append?s.cursor:0),limit:'10'}); if(account) query.set('account',account);
      const result=await api(`/api/history?${query}`);
      if(mode!==s.mine || (mode && account!==s.account)) return;
      const rows=result.records.map(r=>{
        const tr=node('tr'); const kind=node('td'); kind.append(node('span',r.kind==='donation'?'Contribution':'Payout',`kind ${r.kind}`)); tr.append(kind);
        tr.append(node('td',s.data?.campaigns.find(c=>c.id===r.campaignId)?.title || `Campaign ${r.campaignId+1}`),node('td',`${eth(r.amountWei)} ETH`));
        const who=node('td'); who.append(link(short(r.actor),`/address/${r.actor}`)); who.title=r.actor;
        const when=node('td',date(r.timestamp)); when.title=new Date(r.timestamp*1000).toLocaleString();
        const receipt=node('td'); receipt.append(link(r.transactionHash?'View tx ↗':'View block ↗',r.transactionHash?`/tx/${r.transactionHash}`:`/block/${r.blockNumber}`,`Block ${r.blockNumber}`));
        tr.append(who,when,receipt); return tr;
      });
      if(!append) $('history-body').replaceChildren(...rows);
      else $('history-body').append(...rows);
      if(!result.records.length && !append) {const row=node('tr'); const cell=node('td','No confirmed activity yet. Your first contribution will appear here.','empty-cell'); cell.colSpan=6; row.append(cell); $('history-body').append(row);}
      s.cursor=result.nextCursor; $('load-more').hidden=!result.hasMore;
      $('history-message').textContent=`Confirmed donations and withdrawals · block ${result.blockNumber.toLocaleString()}`;
    } catch(error) {$('history-message').textContent=error.message; if(!append) {$('history-body').replaceChildren(); const row=node('tr'),cell=node('td','History is unavailable. Refresh to try again.','empty-cell'); cell.colSpan=6; row.append(cell); $('history-body').append(row);} }
    finally {s.historyBusy=false; $('load-more').disabled=false; if(mode!==s.mine || (mode && account!==s.account)) history();}
  }
  function txView(id,text,hash,check=false) {
    const box=$(id); box.hidden=false; box.replaceChildren(node('p',text));
    if(hash) {box.append(link(`Transaction ${short(hash)} ↗`,`/tx/${hash}`,`Transaction ${short(hash)}`));}
    if(check) {
      const retry=node('button','Check confirmation','text-button'); retry.addEventListener('click',()=>trackPending());
      const clear=node('button','Stop tracking after checking your wallet','text-button');
      clear.addEventListener('click',()=>{storePending(null); box.replaceChildren(node('p','Tracking stopped. This does not cancel a blockchain transaction. Check its receipt before donating again.')); buttons();});
      box.append(retry,clear);
    }
  }
  async function network() {
    const expected=E.toQuantity(s.config.chainId);
    const chain=await s.wallet.request({method:'eth_chainId'});
    if(BigInt(chain)===BigInt(s.config.chainId)) return;
    try {await s.wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:expected}]});}
    catch(error) {
      if(error.code!==4902) throw error;
      await s.wallet.request({method:'wallet_addEthereumChain',params:[{chainId:expected,chainName:s.config.chainName,
        nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[s.config.walletRpcUrl],...(s.config.explorerUrl?{blockExplorerUrls:[s.config.explorerUrl]}:{})}]});
      await s.wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:expected}]});
    }
  }
  function setAccount(accounts) {
    s.account=accounts[0]?E.getAddress(accounts[0]):null;
    s.data=null; $('manage').hidden=true; if(!s.account) s.mine=false;
    $('all-history').classList.toggle('active',!s.mine); $('my-history').classList.toggle('active',s.mine);
    buttons(); refresh(true); history();
  }
  async function connect() {
    if(s.account) {message(`Connected ${s.account}. Use “Disconnect from this page” to disconnect.`); return;}
    if(!s.config?.contractAddress) {message('Set CONTRACT_ADDRESS in Render after deploying CharityHub.sol.',true); return;}
    const wallets=s.providers.filter(p=>p.info.rdns==='io.metamask' || p.provider.isMetaMask);
    const wallet=wallets[0]?.provider || (window.ethereum?.providers?.find(p=>p.isMetaMask)) || window.ethereum;
    if(!wallet) {message('Open this site in MetaMask’s mobile browser, or install the desktop MetaMask extension.',true); $('mobile-link').scrollIntoView({behavior:'smooth',block:'center'}); return;}
    try {
      if(s.wallet!==wallet) {
        s.wallet=wallet;
        wallet.on?.('accountsChanged',setAccount);
        wallet.on?.('chainChanged',()=>{message('Wallet network changed. The required network will be checked before signing.'); refresh(true);});
        wallet.on?.('disconnect',()=>setAccount([]));
      }
      const accounts=await wallet.request({method:'eth_requestAccounts'});
      await network(); setAccount(accounts); message(`Wallet connected on ${s.config.chainName}.`);
    } catch(error) {message(friendly(error),true);}
  }
  async function signerContract() {
    if(!s.wallet || !s.account) throw new Error('Connect MetaMask first.');
    await network();
    const provider=new E.BrowserProvider(s.wallet); const signer=await provider.getSigner();
    if(!same(await signer.getAddress(),s.account)) throw new Error('The wallet account changed. Reconnect and try again.');
    const contract=new E.Contract(s.config.contractAddress,s.config.abi,signer);
    if(await contract.APP_ID()!=='common-good-v1') throw new Error('The deployed contract does not match CharityHub. Check CONTRACT_ADDRESS.');
    return contract;
  }
  async function write(method,args,box,label,value) {
    if(s.busy || s.pending) return;
    s.busy=true; buttons(); txView(box,'Confirm this request in MetaMask.');
    try {
      const contract=await signerContract();
      const tx=await contract[method](...args,...(value===undefined?[]:[{value}]));
      storePending({hash:tx.hash,box,label,account:s.account});
      txView(box,'Submitted. Waiting for a confirmed blockchain receipt…',tx.hash);
      await trackPending(true);
    } catch(error) {txView(box,friendly(error),s.pending?.hash,!!s.pending);}
    finally {s.busy=false; buttons();}
  }
  let tracking=false;
  async function trackPending(alreadyBusy=false) {
    if(!s.pending || tracking) return;
    tracking=true; if(!alreadyBusy) {s.busy=true; buttons();}
    const pending=s.pending; const box=pending.box==='manage-transaction'?'manage-transaction':'transaction';
    if(box==='manage-transaction') $('manage').hidden=false;
    let readError='';
    try {
      for(let i=0;i<45;i++) {
        if(s.pending!==pending) return;
        try {
          const receipt=await api(`/api/receipt/${pending.hash}`);
          if(receipt.status!=='pending') {
            storePending(null);
            txView(box,receipt.status==='confirmed'?`${pending.label} confirmed in block ${receipt.blockNumber}.`:'Transaction reverted on chain. No donation or payout was recorded; gas may still have been charged.',pending.hash);
            await refresh(true); await history(); return;
          }
          readError='';
        } catch(error) {readError=error.message; break;}
        await new Promise(resolve=>setTimeout(resolve,4000));
      }
      txView(box,readError?`Submitted, but confirmation could not be checked: ${readError} Check the transaction before trying again.`:'Confirmation is taking longer than expected. The transaction remains tracked; check your wallet for a replacement or cancellation before trying again.',pending.hash,true);
    } finally {tracking=false; if(!alreadyBusy) {s.busy=false; buttons();}}
  }
  $('connect').addEventListener('click',connect);
  $('disconnect').addEventListener('click',()=>{setAccount([]); message('Disconnected from this page. Wallet permissions can be removed in MetaMask.');});
  $('refresh').addEventListener('click',async()=>{await refresh(true); await history();});
  $('campaign-select').addEventListener('change',event=>select(event.target.value));
  document.querySelectorAll('[data-amount]').forEach(b=>b.addEventListener('click',()=>{$('amount').value=b.dataset.amount; fieldError('donation-error');}));
  $('donation-form').addEventListener('submit',async event=>{
    event.preventDefault(); fieldError('donation-error');
    try {const wei=amount($('amount').value,1); if(!$('consent').checked) throw new Error('Read and accept the funding terms first.');
      const c=s.data?.campaigns.find(c=>c.id===s.selected); if(!c?.active) throw new Error('Choose a campaign that is accepting donations.');
      await write('donate',[c.id],'transaction',`Contribution · ${c.title}`,wei);
    } catch(error) {fieldError('donation-error',friendly(error));}
  });
  $('create-form').addEventListener('submit',async event=>{
    event.preventDefault(); fieldError('create-error');
    try {
      const title=$('create-title').value.trim(),desc=$('create-description').value.trim(),beneficiary=$('create-beneficiary').value.trim();
      const bytes=v=>new TextEncoder().encode(v).length;
      if(bytes(title)<3 || bytes(title)>64) throw new Error('Title must be 3–64 UTF-8 bytes.');
      if(bytes(desc)<10 || bytes(desc)>240) throw new Error('Description must be 10–240 UTF-8 bytes.');
      if(!E.isAddress(beneficiary) || same(beneficiary,E.ZeroAddress) || same(beneficiary,s.config.contractAddress)) throw new Error('Enter a nonzero beneficiary wallet address different from the contract.');
      const goal=amount($('create-goal').value,100), days=Number($('create-days').value);
      if(!Number.isInteger(days) || days<1 || days>365) throw new Error('Duration must be an integer from 1 to 365 days.');
      await write('createCampaign',[title,desc,E.getAddress(beneficiary),goal,days],'manage-transaction',`Campaign creation · ${title}`);
    } catch(error) {fieldError('create-error',friendly(error));}
  });
  for(const [id,mine] of [['all-history',false],['my-history',true]]) $(id).addEventListener('click',()=>{s.mine=mine; $('all-history').classList.toggle('active',!mine); $('my-history').classList.toggle('active',mine); history();});
  $('load-more').addEventListener('click',()=>history(true));
  window.addEventListener('eip6963:announceProvider',event=>{if(!s.providers.some(p=>p.info.uuid===event.detail.info.uuid)) s.providers.push(event.detail);});
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  async function init() {
    if(!E) {message('The wallet library did not load. Reload this page.',true); return;}
    try {
      s.config=await api('/api/config');
      if(s.config.explorerUrl && s.config.contractAddress) {$('contract-link').href=s.config.explorerUrl+'/address/'+s.config.contractAddress; $('contract-link').hidden=false;}
      if(s.config.local) {$('network-label').textContent='LOCAL TEST CHAIN'; document.querySelector('.art-stamp').textContent='LOCAL / TEST';}
      if(location.protocol==='https:') $('mobile-link').href='https://link.metamask.io/dapp/'+location.host+location.pathname;
      try {const p=JSON.parse(localStorage.getItem(pendingKey())); if(p && /^0x[0-9a-fA-F]{64}$/.test(p.hash)) s.pending=p;} catch { /* No pending transaction. */ }
      await refresh(); await history(); buttons();
      if(s.pending) {txView(s.pending.box==='manage-transaction'?'manage-transaction':'transaction','A previous transaction is still tracked. Check confirmation before submitting another.',s.pending.hash,true); trackPending();}
      setInterval(()=>{if(!document.hidden && !s.busy) {refresh(true); history();}},30000);
    } catch(error) {message(error.message,true); $('connection-status').textContent='Connection unavailable';}
  }
  init();
})();
