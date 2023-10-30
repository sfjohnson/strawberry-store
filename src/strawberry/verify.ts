import Stst from '../types'
import { createHash, webcrypto } from 'crypto'

// @ts-ignore
if (!globalThis.crypto) globalThis.crypto = webcrypto // for Node <= v18
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m)) // for synchronous methods

// DEBUG: hashTransaction and signMultiGrant will be really slow for large values as they do lots of unnecessary string-based operations.

// returns 32 bytes encoded as base64
export const hashTransaction = (transaction: Stst.TransactionOperation[]): string => {
  // Transform transaction to guarantee consistent prop ordering for serialisation
  const orderedTransaction = transaction.map((op) => {
    const value = op.value ? op.value.toString('base64') : op.value
    return [ op.action, op.key, value ]
  })

  const hash = createHash('sha256')
  hash.update(JSON.stringify(orderedTransaction))
  return hash.digest('base64')
}

export const signMultiGrant = (multiGrant: Stst.MultiGrant, privKey: string): void => {
  // Transform multiGrant to guarantee consistent prop ordering for serialisation
  const orderedMultiGrant = [
    [...multiGrant.grants.entries()].sort(),
    multiGrant.initiatorPubKey,
    multiGrant.responderPubKey,
    multiGrant.transactionHash
  ]

  const privKeyBuf = Buffer.from(privKey, 'base64')
  const multiGrantBuf = Buffer.from(JSON.stringify(orderedMultiGrant))
  const signature = ed.sign(multiGrantBuf, privKeyBuf)
  multiGrant.signature = Buffer.from(signature).toString('base64')
}

// Verifies ed25519 signature in multiGrant but does not validate (type check) the fields
export const verifyMultiGrant = (multiGrant: Stst.MultiGrant, peerPubKeys: string[], myPubKey?: string): boolean => {
  // First make sure a trusted peer signed this
  // peerPubKeys only contains the other peer's keys, so test against myPubKey separately if required
  const mgKeyInPeerPubKeys = peerPubKeys.includes(multiGrant.responderPubKey)
  const mgKeyIsMyPubKey = myPubKey === multiGrant.responderPubKey // MDN: the strict equality operator always considers operands of different types to be different
  if (!mgKeyInPeerPubKeys && !mgKeyIsMyPubKey) return false

  const orderedMultiGrant = [
    [...multiGrant.grants.entries()].sort(),
    multiGrant.initiatorPubKey,
    multiGrant.responderPubKey,
    multiGrant.transactionHash
  ]

  // Then make sure multiGrant.signature is consistent
  const pubKeyBuf = Buffer.from(multiGrant.responderPubKey, 'base64')
  const sigBuf = Buffer.from(multiGrant.signature, 'base64')
  return ed.verify(sigBuf, Buffer.from(JSON.stringify(orderedMultiGrant)), pubKeyBuf)
}
