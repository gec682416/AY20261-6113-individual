import os
import unittest
from unittest.mock import Mock, patch
from app import create_app
from blockchain import ContractReader, RPCUnavailable

ADDRESS='0x'+'1'*40
ACCOUNT='0x'+'2'*40

class BackendTests(unittest.TestCase):
    def setUp(self):
        self.app=create_app({'TESTING':True,'CONTRACT_ADDRESS':ADDRESS})
        self.reader=Mock()
        self.app.extensions['contract_reader']=self.reader
        self.client=self.app.test_client()

    def test_health_and_config_no_private_rpc_key(self):
        app=create_app({'TESTING':True,'CONTRACT_ADDRESS':ADDRESS,'RPC_URLS':'https://private.example/secret-key'})
        client=app.test_client(); self.assertEqual(client.get('/healthz').status_code,200)
        cfg=client.get('/api/config').json
        self.assertEqual(cfg['chainId'],11155111); self.assertTrue(cfg['abi'])
        self.assertNotIn('secret-key',str(cfg))

    def test_missing_address_returns_actionable_503(self):
        client=create_app({'TESTING':True,'CONTRACT_ADDRESS':''}).test_client()
        response=client.get('/api/state'); self.assertEqual(response.status_code,503); self.assertIn('CONTRACT_ADDRESS',response.json['error'])

    def test_input_validation_precedes_rpc(self):
        for url in ['/api/state?account=bad','/api/history?limit=0','/api/history?limit=21','/api/history?cursor=-1','/api/history?cursor=x','/api/receipt/not-a-hash']:
            self.assertEqual(self.client.get(url).status_code,400,url)
        self.reader.snapshot.assert_not_called(); self.reader.history.assert_not_called(); self.reader.receipt.assert_not_called()

    def test_state_cache_is_account_scoped_and_refreshable(self):
        self.reader.snapshot.return_value={'campaigns':[],'totalDonatedWei':'123'}
        for url in ['/api/state','/api/state','/api/state?account='+ACCOUNT,'/api/state?fresh=1']:
            self.assertEqual(self.client.get(url).status_code,200)
        self.assertEqual(self.reader.snapshot.call_count,3)

    def test_history_forwards_filter_and_pagination(self):
        self.reader.history.return_value={'records':[],'nextCursor':0,'hasMore':False}
        response=self.client.get('/api/history?account='+ACCOUNT+'&cursor=7&limit=2')
        self.assertEqual(response.status_code,200); self.reader.history.assert_called_once_with(ACCOUNT,7,2)

    def test_rpc_failure_json_and_security_headers(self):
        self.reader.snapshot.side_effect=RPCUnavailable('RPC unavailable')
        response=self.client.get('/api/state'); self.assertEqual(response.status_code,503)
        self.assertEqual(response.json['error'],'RPC unavailable'); self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(response.headers['X-Frame-Options'],'DENY')

    def test_receipt_status(self):
        tx='0x'+'a'*64; self.reader.receipt.return_value={'status':'pending','transactionHash':tx}
        self.assertEqual(self.client.get('/api/receipt/'+tx).json['status'],'pending')

    def test_reject_invalid_deployment_configuration(self):
        for cfg in [{'CONTRACT_ADDRESS':'bad'},{'RPC_URLS':'http://external.example'},{'NETWORK':'mainnet'}]:
            with self.assertRaises(ValueError):create_app(cfg)

    def test_failover_verification_and_cooldown(self):
        reader=ContractReader(ADDRESS,['https://bad.example','https://good.example'])
        first=Mock(); first.eth.chain_id=1
        second=Mock(); second.eth.chain_id=11155111; second.eth.get_code.return_value=b'\x01'
        second.eth.contract.return_value.functions.APP_ID.return_value.call.return_value='common-good-v1'
        with patch('blockchain.Web3') as w3:
            w3.side_effect=[first,second]; result=reader.read(lambda web3,contract:'ok')
        self.assertEqual(result,'ok'); self.assertIn('https://bad.example',reader.cooldown); self.assertIn('https://good.example',reader.verified)

    def test_all_rpc_failures_become_503_exception(self):
        reader=ContractReader(ADDRESS,['https://bad.example'])
        fake=Mock(); fake.eth.chain_id=1
        with patch('blockchain.Web3',return_value=fake):
            with self.assertRaises(RPCUnavailable):reader.read(lambda w,c:None)

@unittest.skipUnless(os.getenv('LOCAL_CONTRACT'),'Run with LOCAL_CONTRACT after npm run local-chain')
class LocalIntegration(unittest.TestCase):
    def test_real_rpc_state_history_and_receipt(self):
        reader=ContractReader(os.environ['LOCAL_CONTRACT'],['http://127.0.0.1:8545'],31337)
        state=reader.snapshot(); self.assertEqual(state['donationCount'],3); self.assertEqual(state['activityCount'],4)
        self.assertEqual(state['totalDonatedWei'],'14000000000000000'); self.assertEqual(state['totalWithdrawnWei'],'10000000000000000')
        history=reader.history(limit=2); self.assertEqual(len(history['records']),2); self.assertTrue(history['hasMore'])
        self.assertEqual(history['records'][0]['kind'],'withdrawal'); self.assertTrue(history['records'][0]['transactionHash'])
        receipt=reader.receipt(history['records'][0]['transactionHash']); self.assertEqual(receipt['status'],'confirmed')
        donor=reader.snapshot(history['records'][1]['actor']); self.assertEqual(donor['donor']['count'],3)
        older=reader.history(cursor=history['nextCursor'],limit=2); self.assertFalse(older['hasMore'])

if __name__=='__main__':unittest.main(verbosity=2)
