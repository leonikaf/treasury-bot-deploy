import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http("https://base-mainnet.g.alchemy.com/v2/pqjfmbDFzZhSadbReXv_p") });

const abi = [
  {
    type: "function",
    name: "getOrderHash",
    stateMutability: "view",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          {
            name: "offer",
            type: "tuple[]",
            components: [
              { name: "itemType", type: "uint8" },
              { name: "token", type: "address" },
              { name: "identifierOrCriteria", type: "uint256" },
              { name: "startAmount", type: "uint256" },
              { name: "endAmount", type: "uint256" }
            ]
          },
          {
            name: "consideration",
            type: "tuple[]",
            components: [
              { name: "itemType", type: "uint8" },
              { name: "token", type: "address" },
              { name: "identifierOrCriteria", type: "uint256" },
              { name: "startAmount", type: "uint256" },
              { name: "endAmount", type: "uint256" },
              { name: "recipient", type: "address" }
            ]
          },
          { name: "orderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "conduitKey", type: "bytes32" },
          { name: "totalOriginalConsiderationItems", type: "uint256" },
          { name: "counter", type: "uint256" }
        ]
      }
    ],
    outputs: [{ name: "orderHash", type: "bytes32" }]
  }
] as const;

const order = {
  offerer: "0x3d2C8b92F3fE48e0961d5F9E64506A4E92CE7899" as const,
  zone: "0x0000000000000000000000000000000000000000" as const,
  offer: [
    {
      itemType: 2,
      token: "0x32911f93f2cb1d4d29aeed1657b9bb463461c825" as const,
      identifierOrCriteria: 15732n,
      startAmount: 1n,
      endAmount: 1n
    }
  ],
  consideration: [
    {
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000" as const,
      identifierOrCriteria: 0n,
      startAmount: 1188000000000n,
      endAmount: 1188000000000n,
      recipient: "0x3d2C8b92F3fE48e0961d5F9E64506A4E92CE7899" as const
    },
    {
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000" as const,
      identifierOrCriteria: 0n,
      startAmount: 12000000000n,
      endAmount: 12000000000n,
      recipient: "0x0000a26b00c1f0df003000390027140000faa719" as const
    }
  ],
  orderType: 0,
  startTime: 1760194913n,
  endTime: 1760799713n,
  zoneHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as const,
  salt: 45098155637406307286356911903888948148232505984125529601510462205938214888662n,
  conduitKey: "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000" as const,
  totalOriginalConsiderationItems: 2n,
  counter: 0n
};

const main = async () => {
  const orderHash = await client.readContract({
    address: "0x0000000000000068F116a894984e2DB1123eB395",
    abi,
    functionName: "getOrderHash",
    args: [order]
  });
  console.log("orderHash", orderHash);
};

main();
