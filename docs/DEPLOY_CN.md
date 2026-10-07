# Remix + Render 部署步骤

这是新的 **Common Good 慈善捐款平台**，不是之前的校园投票合约。支持 MetaMask 捐款、受益人提款、链上交易记录、创建和暂停活动，手机可以使用 MetaMask 内置浏览器操作。

## 第一步：Remix 部署新合约

1. 打开 https://remix.ethereum.org/，新建 `CharityHub.sol`，复制仓库 `contracts/CharityHub.sol` 的全部内容。
2. Solidity Compiler：选择 **0.8.24**，开启优化 **200 runs**，Advanced Configurations 中 EVM Version 选 **paris**，然后编译。
3. MetaMask 选择 **Sepolia** 测试网，钱包需要少量测试 ETH 支付 gas。
4. Deploy & Run：Environment 选择 **Browser Extension / Injected Provider - MetaMask**，Contract 选 **CharityHub**，Value 为 **0 wei**。
5. **这个合约的 constructor 不需要任何参数**。点击 Deploy，在钱包确认。
6. 部署成功后复制 Deployed Contracts 中的合约地址。不是交易 hash，也不是自己的钱包地址。

ABI 已经在仓库里，不用另行粘贴。你只需要把新的 CharityHub 合约地址配置到 Render。**不能使用旧的 `0x00a08...` 校园投票合约地址。**

默认三个演示活动的受益人都是部署者钱包。部署者连接网站后可以创建新活动，指定另一个钱包作为受益人，展示权限管理。

## 第二步：Render 部署网站

新建 **Web Service**，连接仓库 `gec682416/AY20261-6113-individual`，填写：

| 项目 | 填写内容 |
| --- | --- |
| Branch | `main` |
| Language / Runtime | **Python 3** |
| Root Directory | **留空** |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn --bind 0.0.0.0:$PORT --threads 4 --timeout 60 app:app` |
| Instance Type | Free |
| Health Check Path | `/healthz` |

Environment Variables 添加：

| Key | Value |
| --- | --- |
| `CONTRACT_ADDRESS` | 你刚部署的 **CharityHub Sepolia 地址** |
| `RPC_URLS` | `https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.gateway.tenderly.co` |
| `NETWORK` | `sepolia`，也可以不填，默认就是 Sepolia |

部署后打开 Render 的 HTTPS 链接。先确认活动金额加载成功，再连接钱包，用 **0.001 测试 ETH** 演示捐款，钱包还要留 ETH 支付 gas。受益人钱包连接后，下方会出现提款按钮。部署者钱包还会看到创建活动、暂停/恢复功能。

## 第三步：手机和作业证据

- 普通手机浏览器可看页面；捐款请在 **MetaMask App 的浏览器**打开 Render 链接，也可使用网站的 Open in MetaMask。
- 捐款是最终的，没有退款功能；受益人可以在达到目标金额之前提款。目标金额只是参考，不是必须达到才能提款的门槛。
- 保存 Remix 部署成功、钱包捐款确认、网站交易记录、受益人提款和手机页面截图。
- `output/pdf/Common-Good-Report-Draft.pdf` 是 **7 页英文报告初稿**。提交前补上姓名/学号、Render 链接、新合约地址、Sepolia 交易 hash 和部署后的截图。初稿中的截图与测试都是本地真实测试，不是假冒的 Sepolia 部署结果。
- 如果页面显示 Connection unavailable，先检查新合约地址与网络。不要把 seed phrase 或私钥填进 Render。已经提交但尚未查到确认的交易，先查钱包或交易链接，再决定是否重试。
