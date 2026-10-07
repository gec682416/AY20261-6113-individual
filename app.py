"""Flask supplies on-chain reads; MetaMask alone signs donations and withdrawals."""
import os
import re
import time
from urllib.parse import urlparse
from flask import Flask, jsonify, render_template, request
from web3 import Web3
from blockchain import ABI, ContractReader, RPCUnavailable, ZERO


def create_app(overrides=None):
    app = Flask(__name__)
    app.config.update(CONTRACT_ADDRESS=os.getenv("CONTRACT_ADDRESS", "").strip(),
        RPC_URLS=os.getenv("RPC_URLS", "https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.gateway.tenderly.co"),
        NETWORK=os.getenv("NETWORK", "sepolia"), MAX_CONTENT_LENGTH=8192)
    if overrides:
        app.config.update(overrides)
    address = app.config["CONTRACT_ADDRESS"]
    if address and (not Web3.is_address(address) or int(address, 16) == 0):
        raise ValueError("CONTRACT_ADDRESS must be a nonzero Ethereum address")
    urls = [u.strip() for u in app.config["RPC_URLS"].split(",") if u.strip()]
    if not 1 <= len(urls) <= 3:
        raise ValueError("Provide 1 to 3 RPC_URLS")
    for url in urls:
        parsed = urlparse(url)
        if not parsed.hostname or (parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
        )):
            raise ValueError("RPC_URLS requires HTTPS (localhost HTTP is allowed for tests)")
    if app.config["NETWORK"] not in {"sepolia", "local"}:
        raise ValueError("NETWORK must be sepolia or local")
    local = app.config["NETWORK"] == "local"
    chain_id = 31337 if local else 11155111
    reader = ContractReader(address, urls, chain_id) if address else None
    app.extensions["contract_reader"] = reader
    state_cache = {}

    def account_arg():
        raw = request.args.get("account", "")
        if not raw:
            return None
        if not Web3.is_address(raw) or int(raw, 16) == 0:
            raise ValueError("Invalid wallet address")
        return Web3.to_checksum_address(raw)

    def require_reader():
        if not app.extensions["contract_reader"]:
            raise RPCUnavailable("Deploy CharityHub.sol and set CONTRACT_ADDRESS in Render before using this app.")
        return app.extensions["contract_reader"]

    @app.get("/")
    def home():
        return render_template("index.html")

    @app.get("/api/config")
    def config():
        return jsonify(contractAddress=Web3.to_checksum_address(address) if address else "", abi=ABI,
            chainId=chain_id, chainName="Local test chain" if local else "Sepolia", local=local,
            explorerUrl="" if local else "https://sepolia.etherscan.io",
            walletRpcUrl="http://127.0.0.1:8545" if local else "https://ethereum-sepolia-rpc.publicnode.com")

    @app.get("/api/state")
    def state():
        account = account_arg()
        key = account or ZERO
        cached = state_cache.get(key)
        if request.args.get("fresh") != "1" and cached and time.monotonic() - cached[0] < 5:
            return jsonify(cached[1])
        result = require_reader().snapshot(account)
        if len(state_cache) >= 64:
            state_cache.clear()
        state_cache[key] = (time.monotonic(), result)
        return jsonify(result)

    @app.get("/api/history")
    def history():
        account = account_arg()
        try:
            cursor = int(request.args.get("cursor", "0"))
            limit = int(request.args.get("limit", "10"))
        except ValueError:
            raise ValueError("Cursor and limit must be integers") from None
        if not 0 <= cursor < 2**64 or not 1 <= limit <= 20:
            raise ValueError("Cursor must be nonnegative; limit must be 1 to 20")
        return jsonify(require_reader().history(account, cursor, limit))

    @app.get("/healthz")
    def health():
        return jsonify(status="ok", configured=bool(address))

    @app.get("/api/receipt/<tx_hash>")
    def receipt(tx_hash):
        if not re.fullmatch(r"0x[0-9a-fA-F]{64}", tx_hash):
            raise ValueError("Invalid transaction hash")
        return jsonify(require_reader().receipt(tx_hash))

    @app.errorhandler(ValueError)
    def invalid(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(RPCUnavailable)
    def unavailable(error):
        return jsonify(error=str(error)), 503

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app


app = create_app()
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5005")))
