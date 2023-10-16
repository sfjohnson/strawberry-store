import Stst from '../types'
import crypto from 'crypto'
import * as ed from '@noble/ed25519'

// DEBUG: hashTransaction and signMultiGrant will be really slow for large values as they do lots of unnecessary string-based operations.

// returns 32 bytes encoded as base64
export const hashTransaction = (transaction: Stst.TransactionOperation[]): string => {
  // Transform transaction to guarantee consistent prop ordering for serialisation
  const orderedTransaction = transaction.map((op) => {
    const value = op.value ? op.value.toString('base64') : op.value
    return [ op.action, op.key, value ]
  })

  const hash = crypto.createHash('sha256')
  hash.update(JSON.stringify(orderedTransaction))
  return hash.digest('base64')
}

export const signMultiGrant = async (multiGrant: Stst.MultiGrant, privKey: string): Promise<void> => {
  // Transform multiGrant to guarantee consistent prop ordering for serialisation
  const orderedMultiGrant = [
    [...multiGrant.grants.entries()].sort(),
    multiGrant.initiatorPubKey,
    multiGrant.responderPubKey,
    multiGrant.transactionHash
  ]

  const privKeyBuf = Buffer.from(privKey, 'base64')
  const multiGrantBuf = Buffer.from(JSON.stringify(orderedMultiGrant))
  const signature = await ed.signAsync(multiGrantBuf, privKeyBuf)
  multiGrant.signature = Buffer.from(signature).toString('base64')
}

// Verifies ed25519 signature in multiGrant but does not validate the fields
export const verifyMultiGrant = async (multiGrant: Stst.MultiGrant, peerPubKeys: string[], myPubKey?: string): Promise<boolean> => {
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
  return await ed.verifyAsync(sigBuf, Buffer.from(JSON.stringify(orderedMultiGrant)), pubKeyBuf)
}
