const { PrivateKey, Hash, Utils } = require('@bsv/sdk')
const crypto = require('crypto')

const pk = PrivateKey.fromRandom()
const pub = pk.toPublicKey()

// Mainnet
console.log('Mainnet:', pub.toAddress())

// Testnet - manual P2PKH with 0x6f prefix
const pubEncoded = pub.encode(true)
const hash160 = Hash.hash160(pubEncoded)
const prefix = Uint8Array.from([0x6f])
const payload = new Uint8Array(prefix.length + hash160.length)
payload.set(prefix, 0)
payload.set(hash160, prefix.length)
const checksum = Hash.hash256(payload).slice(0, 4)
const full = new Uint8Array(payload.length + checksum.length)
full.set(payload, 0)
full.set(checksum, payload.length)
console.log('Testnet:', Utils.toBase58(full))
console.log('WIF:', pk.toWif())

// Also check toAddress with network param
try {
  console.log('toAddress testnet:', pub.toAddress('testnet'))
} catch(e) {
  console.log('toAddress testnet not supported:', e.message)
}
