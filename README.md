# Common Good - Charity Donation DApp

6113 Individual Assignment: an original financial DApp for transparent community donations. **Sepolia test ETH only.** Built with Solidity, Flask, HTML/CSS/JavaScript, ethers.js and MetaMask. This is a coursework prototype, not a verified charity or a production fundraising service.

## Features

- Public campaign goals, beneficiaries, raised amounts and paid-out amounts read from Ethereum.
- MetaMask connection on desktop; responsive mobile page and MetaMask in-app browser link.
- Actual payable `donate` transactions, beneficiary-only `withdraw` transactions, and receipt confirmation.
- Administrator-only campaign creation and pause/resume controls enforced by Solidity.
- On-chain donation/withdrawal history, newest first, with global/personal filters and pagination.
- Exact wei accounting, input validation, rejected-wallet feedback, RPC failover and pending-transaction recovery.
- No signing keys on the server; no database is required. Restarting Render does not erase on-chain history.

## Financial rules - read before testing

This is **flexible funding**, not an all-or-nothing crowdfunding contract. Donations are final. The beneficiary can withdraw the campaign's full available balance at any time, even before reaching its target, while paused, or after the deadline. There is no refund function. A target is not a cap: donations can exceed it. Each donation must be over zero and at most **1 test ETH**; gas is additional.

The deployer is the permanent administrator. Deployment creates three clearly labelled demo causes whose beneficiary is the deployer's wallet. To demonstrate a different beneficiary, the administrator creates another campaign using that wallet address. The administrator cannot withdraw a campaign assigned to another beneficiary. Campaign metadata and beneficiary addresses cannot be edited after creation. Administrators can create up to 32 campaigns and pause future donations, but cannot confiscate another campaign's funds.

Wallet addresses and financial activity are public. Campaigns are not identity-verified and blockchain transparency cannot prove how money is spent after withdrawal. Do not put personal or sensitive data in descriptions. A contract beneficiary must accept ETH transfers or withdrawals will revert.

## 1. Deploy the smart contract in Remix

1. Open [Remix](https://remix.ethereum.org/) and create `CharityHub.sol`. Copy the entire [contract](contracts/CharityHub.sol).
2. Solidity Compiler: select **0.8.24**, enable optimization with **200 runs**, set **EVM version = paris** in advanced settings, then compile.
3. In MetaMask, select **Sepolia** and have test ETH available for deployment gas. Do not select Ethereum Mainnet.
4. Deploy & Run: Environment = **Browser Extension / Injected Provider - MetaMask**, Contract = **CharityHub**, Value = **0 wei**. This constructor has **no parameters**, so there are no duration fields to fill.
5. Click Deploy and confirm in MetaMask. Wait for a successful receipt. Copy the **deployed contract address**, not the transaction hash or your wallet address.
6. Check `APP_ID()` returns `common-good-v1` and `getCampaigns()` returns three campaigns.

Explorer source verification is optional for execution. An Etherscan API-key warning or another explorer verification timeout does not undo a successful deployment.

**The old CampusBallot address must not be used. Deploy this new CharityHub contract.** Its ABI is already included in `contracts/CharityHub.abi.json` and supplied to the browser by `/api/config`. You only need to set the new contract address in Render. If you change the Solidity interface, regenerate the ABI with `npm ci && npm run build:contracts` and commit it.

## 2. Deploy the Flask web service on Render

In [Render](https://dashboard.render.com/), create a **Web Service** and connect this GitHub repository:

`gec682416/AY20261-6113-individual`

| Render setting | Value |
| --- | --- |
| Branch | `main` |
| Language / Runtime | **Python 3** (not Node) |
| Root Directory | **Leave blank** |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn --bind 0.0.0.0:$PORT --threads 4 --timeout 60 app:app` |
| Instance type | Free is sufficient for the demonstration |
| Health Check Path | `/healthz` |

Add environment variables:

| Key | Value |
| --- | --- |
| `CONTRACT_ADDRESS` | Your **new CharityHub Sepolia contract address** from Remix |
| `RPC_URLS` | `https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.gateway.tenderly.co` |
| `NETWORK` | `sepolia` (optional; default) |

`render.yaml` also supports Render Blueprint deployment. `CONTRACT_ADDRESS` must still be supplied. No npm build is required on Render: the ethers.js browser bundle and ABI are committed. `.python-version` selects Python 3.13. Never enter a seed phrase or private key in Render.

After deployment, open the Render HTTPS URL and confirm the campaign totals load. Connect MetaMask and donate `0.001` test ETH, with additional ETH available for gas. Confirm the receipt and history. Connect the deployer wallet to see administrator and demo-beneficiary controls. On a phone, open the same Render URL **inside MetaMask's browser**. Ordinary phone browsers can view data, but often do not inject a signing wallet.

Free Render services can take time to wake after inactivity. If reads fail, check the contract address, Sepolia deployment, Render logs and RPC availability. `RPC_URLS` supports 1-3 comma-separated HTTPS endpoints; a provider-specific Sepolia RPC can replace a throttled public endpoint. Private provider URLs remain server-side. `/healthz` checks the web process, while `/api/state` checks chain access.

## 3. Run locally against Sepolia

Python 3.13 recommended:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export CONTRACT_ADDRESS=YOUR_NEW_SEPOLIA_CONTRACT_ADDRESS
python app.py
```

Open `http://127.0.0.1:5005`. `.env.example` documents settings; this app reads environment variables and does not automatically load `.env` files.

## 4. Tests and disposable local demonstration

Node 20 or 22 LTS is recommended for development tools. Node is not needed by the Render service.

```sh
npm ci
npm run build:contracts
npm run vendor
npm test
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

Contract tests exercise real Ganache EVM transactions: successful donations, monetary accounting, unauthorized operations, invalid inputs, paused/expired campaigns, history, reentrancy and failed beneficiary transfer rollback. Backend tests cover validation, account-scoped caching, provider failover and error responses. Ganache may fall back to its JavaScript transport on newer Node versions; this does not prevent tests.

For browser verification without deploying to Sepolia:

```sh
# Terminal 1: disposable chain; generates an ignored local address file
npm run local-chain
```

In terminal 2, copy the address from `artifacts/local-address.json`:

```sh
export CONTRACT_ADDRESS=LOCAL_ADDRESS_FROM_THE_FILE
export RPC_URLS=http://127.0.0.1:8545
export NETWORK=local
.venv/bin/python app.py
```

```sh
# Optional real backend RPC integration test on the clean local fixture
LOCAL_CONTRACT=LOCAL_ADDRESS_FROM_THE_FILE .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
# Optional front-end wallet-controller integration with disposable local accounts
LOCAL_UI_TEST=1 npm run test:ui
```

The UI test uses a synthetic EIP-1193 provider in a Node DOM test environment, not your MetaMask or real assets. Start a fresh local fixture before rerunning fixture-specific tests. Local mode is for development only; leave Render on Sepolia. See [testing evidence and deployment checklist](docs/TESTING.md).

## Architecture and source

```text
Browser HTML/CSS/JS -- same-origin JSON --> Flask -- read-only RPC --> CharityHub
Browser ethers.js  -- MetaMask signing --> Sepolia transaction --> CharityHub
Flask              <-- blocks / logs / receipts ---------------- CharityHub
```

| Path | Responsibility |
| --- | --- |
| `contracts/CharityHub.sol` | Funding rules, permissions, accounting and paginated activity |
| `contracts/CharityHub.abi.json` | Generated contract interface |
| `app.py` | Flask pages, config/state/history/receipt APIs and validation |
| `blockchain.py` | Read-only chain access, verification, failover, block-consistent snapshots |
| `templates/index.html`, `static/` | Responsive UI, wallet controller and vendored ethers |
| `tests/` | Contract, backend and local UI integration tests |
| `scripts/` | Compiler, local fixture, vendor bundle and editable report generator |
| `docs/screenshots/` | Actual local desktop/mobile screenshots, not Sepolia evidence |
| `output/pdf/` | Seven-page report draft; public deployment evidence must be added |

## Submission

The included report covers the required sections and distinguishes verified local tests from pending public-network tests. Before submitting, add your name/student ID, the new Sepolia address, successful Sepolia donation and withdrawal hashes, the Render URL, and screenshots of Remix, MetaMask and the deployed website. Follow `docs/TESTING.md`. The report is a draft until these checks are completed; no deployment results are fabricated.

Primary references: [Solidity security considerations](https://docs.soliditylang.org/en/latest/security-considerations.html), [ethers v6](https://docs.ethers.org/v6/), [MetaMask Ethereum provider](https://docs.metamask.io/wallet/reference/provider-api/), [Render Flask deployment](https://render.com/docs/deploy-flask).

MIT licensed. ethers.js retains its upstream license in `static/vendor/ethers-LICENSE.md`.
