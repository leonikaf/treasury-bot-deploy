const { keccak256, encodeAbiParameters } = require("viem");
const { TextEncoder } = require("util");

const domainTypeHash = keccak256(new TextEncoder().encode("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const nameHash = keccak256(new TextEncoder().encode("Seaport"));
const versionHash = keccak256(new TextEncoder().encode("1.6"));
const chainId = 8453n;
const verifyingContract = "0x0000000000000068f116a894984e2db1123eb395";
const domainSeparator = keccak256(
  encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" }
    ],
    [domainTypeHash, nameHash, versionHash, chainId, verifyingContract]
  )
);
console.log("domainSeparator", domainSeparator);

const structHash = "0x68e620a9aca8dfbfca53baffed62f3cba0931a29d65f16967ab5dc89c606c60a";
const digest = keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`);
console.log("digest", digest);
