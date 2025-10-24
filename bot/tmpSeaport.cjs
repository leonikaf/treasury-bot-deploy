const { ethers, Wallet } = require("ethers");
const { Seaport } = require("@opensea/seaport-js");

const provider = new ethers.JsonRpcProvider("https://base-mainnet.g.alchemy.com/v2/pqjfmbDFzZhSadbReXv_p");
const dummySigner = Wallet.createRandom().connect(provider);

const seaport = new Seaport(dummySigner, { overrides: { seaportAddress: "0x0000000000000068F116a894984e2DB1123eB395" } });

const order = {
  offerer: "0x3d2C8b92F3fE48e0961d5F9E64506A4E92CE7899",
  zone: "0x0000000000000000000000000000000000000000",
  offer: [
    {
      itemType: 2,
      token: "0x32911f93f2cb1d4d29aeed1657b9bb463461c825",
      identifierOrCriteria: "15732",
      startAmount: "1",
      endAmount: "1"
    }
  ],
  consideration: [
    {
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: "0",
      startAmount: "1188000000000",
      endAmount: "1188000000000",
      recipient: "0x3d2C8b92F3fE48e0961d5F9E64506A4E92CE7899"
    },
    {
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: "0",
      startAmount: "12000000000",
      endAmount: "12000000000",
      recipient: "0x0000a26b00c1f0df003000390027140000faa719"
    }
  ],
  orderType: 0,
  startTime: "1760194913",
  endTime: "1760799713",
  zoneHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  salt: "0x63b4a6cabfcf8e9039ac5a5598c3958fc5254efd762e2f964e8aa5b03037e4d6",
  conduitKey: "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000",
  counter: 0
};

console.log("hash", seaport.getOrderHash(order));
