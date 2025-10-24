import { encodeAbiParameters, keccak256, hashTypedData } from "viem";

const domain = {
  name: "Seaport",
  version: "1.6",
  chainId: 8453,
  verifyingContract: "0x0000000000000068f116a894984e2db1123eb395"
};

const offerItemTypeHash = keccak256(new TextEncoder().encode("OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)"));
const considerationItemTypeHash = keccak256(new TextEncoder().encode("ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)"));
const orderTypeHashNoTotal = keccak256(new TextEncoder().encode("OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)"));
const orderTypeHashWithTotal = keccak256(new TextEncoder().encode("OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 totalOriginalConsiderationItems,uint256 counter)OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)"));

const typesNoTotal = {
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" }
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" }
  ],
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "counter", type: "uint256" }
  ]
};

const typesWithTotal = {
  ...typesNoTotal,
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "totalOriginalConsiderationItems", type: "uint256" },
    { name: "counter", type: "uint256" }
  ]
};

const messageBase = {
  offerer: "0x3d2c8b92f3fe48e0961d5f9e64506a4e92ce7899",
  zone: "0x0000000000000000000000000000000000000000",
  offer: [
    {
      itemType: 2,
      token: "0x32911f93f2cb1d4d29aeed1657b9bb463461c825",
      identifierOrCriteria: 15732n,
      startAmount: 1n,
      endAmount: 1n
    }
  ],
  consideration: [
    {
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: 0n,
      startAmount: 1188000000000n,
      endAmount: 1188000000000n,
      recipient: "0x3d2c8b92f3fe48e0961d5f9e64506a4e92ce7899"
    },
    {
      itemType: 0,
      token: "0x0000000000000000000000000000000000000000",
      identifierOrCriteria: 0n,
      startAmount: 12000000000n,
      endAmount: 12000000000n,
      recipient: "0x0000a26b00c1f0df003000390027140000faa719"
    }
  ],
  orderType: 0,
  startTime: 1760194913n,
  endTime: 1760799713n,
  zoneHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  salt: 45098155637406307286356911903888948148232505984125529601510462205938214888662n,
  conduitKey: "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000",
  counter: 0n
};

const messageWithTotal = { ...messageBase, totalOriginalConsiderationItems: 2n };

console.log("digestNoTotal", hashTypedData({ domain, types: typesNoTotal, primaryType: "OrderComponents", message: messageBase }));
console.log("digestWithTotal", hashTypedData({ domain, types: typesWithTotal, primaryType: "OrderComponents", message: messageWithTotal }));

function structHash(message, includeTotal) {
  const offerHashes = message.offer.map((item) =>
    keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "uint8" },
          { type: "address" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" }
        ],
        [
          offerItemTypeHash,
          BigInt(item.itemType),
          item.token,
          BigInt(item.identifierOrCriteria),
          BigInt(item.startAmount),
          BigInt(item.endAmount)
        ]
      )
    )
  );
  const considerationHashes = message.consideration.map((item) =>
    keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "uint8" },
          { type: "address" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "address" }
        ],
        [
          considerationItemTypeHash,
          BigInt(item.itemType),
          item.token,
          BigInt(item.identifierOrCriteria),
          BigInt(item.startAmount),
          BigInt(item.endAmount),
          item.recipient
        ]
      )
    )
  );
  const listHash = (hashes) =>
    keccak256(`0x${hashes.map((h) => h.slice(2)).join("")}`);
  const params = [
    includeTotal ? orderTypeHashWithTotal : orderTypeHashNoTotal,
    message.offerer,
    message.zone,
    listHash(offerHashes),
    listHash(considerationHashes),
    BigInt(message.orderType),
    BigInt(message.startTime),
    BigInt(message.endTime),
    message.zoneHash,
    BigInt(message.salt),
    message.conduitKey
  ];
  if (includeTotal) {
    params.push(BigInt(message.totalOriginalConsiderationItems ?? message.consideration.length));
  }
  params.push(BigInt(message.counter));
  return keccak256(
    encodeAbiParameters(
      includeTotal
        ? [
            { type: "bytes32" },
            { type: "address" },
            { type: "address" },
            { type: "bytes32" },
            { type: "bytes32" },
            { type: "uint8" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "uint256" },
            { type: "uint256" }
          ]
        : [
            { type: "bytes32" },
            { type: "address" },
            { type: "address" },
            { type: "bytes32" },
            { type: "bytes32" },
            { type: "uint8" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "uint256" }
          ],
      params
    )
  );
}

console.log("structNoTotal", structHash(messageBase, false));
console.log("structWithTotal", structHash(messageWithTotal, true));
