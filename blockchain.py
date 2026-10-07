"""Read-only contract access with endpoint failover. No signing keys or transaction writes."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import time

from web3 import Web3
from web3.exceptions import TransactionNotFound, ContractLogicError

ABI = json.loads((Path(__file__).parent / "contracts/CharityHub.abi.json").read_text())
ZERO = "0x" + "0" * 40
ACTIVITY_TOPIC = Web3.keccak(text="ActivityRecorded(uint256,uint256,address,uint256,uint8,uint256)").hex()


class RPCUnavailable(Exception):
    pass


class InvalidReadRequest(ValueError):
    pass


class ContractReader:
    def __init__(self, address, rpc_urls, chain_id=11155111):
        self.address = Web3.to_checksum_address(address)
        self.urls = rpc_urls
        self.chain_id = chain_id
        self.verified = {}
        self.cooldown = {}

    def read(self, operation):
        last_error = None
        for url in self.urls:
            if self.cooldown.get(url, 0) > time.monotonic():
                continue
            # One bounded attempt per endpoint; our own failover replaces web3's default retries.
            w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 5}, exception_retry_configuration=None))
            contract = w3.eth.contract(address=self.address, abi=ABI)
            try:
                if self.verified.get(url, 0) < time.monotonic():
                    if w3.eth.chain_id != self.chain_id:
                        raise ValueError("RPC chain mismatch")
                    if not w3.eth.get_code(self.address):
                        raise ValueError("No deployed contract at configured address")
                    if contract.functions.APP_ID().call() != "common-good-v1":
                        raise ValueError("Contract identity mismatch")
                    self.verified[url] = time.monotonic() + 60
                return operation(w3, contract)
            except InvalidReadRequest:
                raise
            except ContractLogicError as error:
                raise ValueError("Contract rejected the read request; refresh history and try again.") from error
            except Exception as error:
                last_error = error
                self.cooldown[url] = time.monotonic() + 10
        raise RPCUnavailable("Cannot read the configured contract. Check its address, network, or RPC availability.") from last_error

    def snapshot(self, account=None):
        def operation(w3, contract):
            block = w3.eth.get_block("latest")
            tag = block["number"]
            calls = [contract.functions.getOverview(), contract.functions.getCampaigns()]
            if account:
                calls += [contract.functions.donorTotal(account), contract.functions.donorCount(account)]
            with ThreadPoolExecutor(max_workers=4) as pool:
                values = list(pool.map(lambda call: call.call(block_identifier=tag), calls))
            owner, count, donated, withdrawn, contributions, activity_count = values[0]
            campaigns = []
            for c in values[1]:
                campaigns.append(dict(id=c[0], title=c[1], description=c[2], beneficiary=c[3],
                    goalWei=str(c[4]), raisedWei=str(c[5]), withdrawnWei=str(c[6]), availableWei=str(c[5]-c[6]),
                    donationCount=c[7], deadline=c[8], paused=c[9], active=not c[9] and block["timestamp"] < c[8]))
            return dict(owner=owner, campaignCount=count, totalDonatedWei=str(donated),
                totalWithdrawnWei=str(withdrawn), availableWei=str(donated-withdrawn), donationCount=contributions,
                activityCount=activity_count, campaigns=campaigns, blockNumber=tag, chainTimestamp=block["timestamp"],
                donor=dict(totalWei=str(values[2]), count=values[3]) if account else None)
        return self.read(operation)

    def receipt(self, tx_hash):
        def operation(w3, contract):
            try:
                receipt = w3.eth.get_transaction_receipt(tx_hash)
            except TransactionNotFound:
                return dict(status="pending", transactionHash=tx_hash)
            if not receipt.get("to") or receipt["to"].lower() != self.address.lower():
                raise InvalidReadRequest("This transaction was not sent to the configured contract")
            return dict(status="confirmed" if receipt["status"] == 1 else "failed",
                transactionHash=Web3.to_hex(receipt["transactionHash"]), blockNumber=receipt["blockNumber"],
                sender=receipt["from"], confirmations=max(0, w3.eth.block_number - receipt["blockNumber"] + 1))
        return self.read(operation)

    def history(self, account=None, cursor=0, limit=10):
        def operation(w3, contract):
            block = w3.eth.block_number
            rows, next_cursor, has_more = contract.functions.getHistory(cursor, limit, account or ZERO).call(block_identifier=block)
            # Each receipt stores its block; fetch exactly those blocks instead of scanning the chain.
            def block_logs(number):
                try:
                    return w3.eth.get_logs({"address": self.address, "fromBlock": number, "toBlock": number,
                        "topics": ["0x" + ACTIVITY_TOPIC.removeprefix("0x")]})
                except Exception:
                    # Receipt history remains valid if an endpoint's log API is temporarily unavailable.
                    return []
            hashes = {}
            with ThreadPoolExecutor(max_workers=4) as pool:
                for logs in pool.map(block_logs, sorted({r[6] for r in rows})):
                    for log in logs:
                        hashes[int.from_bytes(log["topics"][1], "big")] = Web3.to_hex(log["transactionHash"])
            return dict(records=[dict(id=r[0], campaignId=r[1], actor=r[2], amountWei=str(r[3]),
                kind="donation" if r[4] == 0 else "withdrawal", timestamp=r[5], blockNumber=r[6],
                transactionHash=hashes.get(r[0])) for r in rows], nextCursor=next_cursor, hasMore=has_more,
                blockNumber=block)
        return self.read(operation)
