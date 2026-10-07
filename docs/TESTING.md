# Testing evidence and final deployment checklist

## Verified locally, 7 October 2026

Environment: Solidity 0.8.24 / optimizer 200 / Paris, Ganache 7.9.2 (chain 31337), ethers 6.16.0, Flask 3.1.2, web3.py 7.13.0. All money in this evidence is disposable local-chain ETH.

| Test group | Evidence |
| --- | --- |
| Contract EVM suite | 12 scenarios passed (Node counts the parent suite as an additional passed test) |
| Backend suite | 10 validation/cache/failover/API tests plus 1 real local-RPC integration test passed |
| Clean local fixture | 3 donations total 0.014 ETH; 1 payout 0.010 ETH; remaining 0.004 ETH |
| Activity API | Newest-first records, transaction hashes from indexed logs, two-page pagination |
| Receipt API | Local beneficiary payout correctly reported as confirmed |
| Browser rendering | Desktop and 390 x 844 mobile viewport; no document-wide horizontal overflow at 390px |
| UI basic controls | Campaign selector and amount preset update donation form; donation disabled before wallet connection |
| Wallet-controller integration | Passed: synthetic EIP-1193 connection, invalid amount, donations, admin campaign creation, beneficiary payout, rejection, personal history and recovery from a simulated receipt-read outage |

Contract scenarios include paused donation rejection, withdrawals while paused/expired, invalid campaign IDs, zero/excessive donation amounts, owner-only administration, beneficiary-only payout, goals exceeded, direct transfers rejected, reverse/personal history, reentrant withdrawal blocked, and state rollback for rejecting beneficiaries. These tests do not constitute an independent security audit.

`docs/screenshots/*-local.jpg` and related campaign/form/history images were captured from the real local UI connected to the clean fixture. The site explicitly displays LOCAL TEST CHAIN. These are **not** evidence of Remix/Sepolia/Render deployment.

## Public deployment - complete before submission

- [ ] Add your name, student ID and course details to the report.
- [ ] Deploy the new CharityHub contract in Remix using Sepolia, value 0, no constructor parameters.
- [ ] Save contract address, deployment transaction hash and Remix success screenshot.
- [ ] Configure Render Python Web Service with CONTRACT_ADDRESS and confirm `/api/state` succeeds.
- [ ] Add the Render HTTPS URL to README/report.
- [ ] Desktop MetaMask: connect Sepolia and donate 0.001 test ETH; save transaction hash and confirmation screenshot.
- [ ] Verify campaign raised amount, personal contribution totals and public history update after confirmation.
- [ ] Beneficiary: withdraw available test ETH; save payout hash and history screenshot.
- [ ] Create a campaign with a different beneficiary; show an unrelated wallet cannot withdraw it.
- [ ] Reject a wallet confirmation and show the cancellation message; validate an amount of zero or more than 1 ETH.
- [ ] Check pause/resume using the administrator wallet. A paused campaign must refuse new donations.
- [ ] Open the Render URL in MetaMask's mobile browser and perform a small test donation.
- [ ] Refresh/reopen the site to confirm on-chain history persists; record any remaining pending transaction.
- [ ] Update the seven-page draft with actual public results and your explanation of implementation/challenges.

Do not publish seed phrases/private keys or private RPC URLs in screenshots. Contract address and transaction hashes are public and suitable evidence.

## Known limitations

Public endpoints and free Render hosting can have latency/throttling/cold starts. A confirmation-read failure is not proof that a transaction failed; inspect its explorer receipt before resubmitting. The app remembers a pending transaction on this browser and contract; a wallet replacement/cancellation may require checking MetaMask and explicitly stopping tracking. Confirmation means one inclusion, not absolute blockchain finality. Fund use after withdrawal, charity identity and refunds are outside this prototype. Campaigns are bounded to 32; contract metadata is immutable; administrator authority has no transfer or recovery mechanism. Paginated activity storage grows with use and costs gas. No production benchmark or public Sepolia deployment has been claimed by the local test evidence.
