// In a client-server model this would be the server

import { ProtocolMessageType, TransactionOperationAction } from '../enums'
import { lockKeys, unlockKeys, getKey, setKey } from '../bread'
import { serialiseMessage } from './protocol'
import { hashTransaction, verifyMultiGrant } from './verify'
import { numberToTimestamp } from '../common/utils'

let initDone = false
let _myPubKey: string
let _peerPubKeys: string[]
let _maxFaultyPeers: number

export const initResponderWrite2 = (myPubKey: string, peerPubKeys: string[], maxFaultyPeers: number) => {
  _myPubKey = myPubKey
  _peerPubKeys = peerPubKeys
  _maxFaultyPeers = maxFaultyPeers
  initDone = true
}

const verifyWriteCertificate = async (writeCertificate: Stst.WriteCertificate, transaction: Stst.TransactionOperation[]): Promise<void> => {
  if (writeCertificate.length !== 2 * _maxFaultyPeers + 1) {
    throw new Error(`writeCertificate must contain exactly ${2 * _maxFaultyPeers + 1} MultiGrants`)
  }

  const initiatorPubKeys: Set<string> = new Set()
  const responderPubKeys: Set<string> = new Set()
  const transactionHashes: Set<string> = new Set()

  for (const multiGrant of writeCertificate) {
    if (!(multiGrant.grants instanceof Map)) throw new Error('grants must be a Map')
    if (typeof multiGrant.initiatorPubKey !== 'string') throw new Error('initiatorPubKey must be a string')
    if (typeof multiGrant.responderPubKey !== 'string') throw new Error('responderPubKey must be a string')
    if (typeof multiGrant.transactionHash !== 'string') throw new Error('transactionHash must be a string')
    // Test against myPubKey as well as peerPubKeys for when we receive back a multiGrant that we just signed during write1
    if (!(await verifyMultiGrant(multiGrant, _peerPubKeys, _myPubKey))) throw new Error('multiGrant signature is invalid')

    initiatorPubKeys.add(multiGrant.initiatorPubKey)
    responderPubKeys.add(multiGrant.responderPubKey)
    transactionHashes.add(multiGrant.transactionHash)
  }

  if (initiatorPubKeys.size !== 1) throw new Error('initiatorPubKey mismatch within writeCertificate')
  if (transactionHashes.size !== 1) throw new Error('transactionHash mismatch within writeCertificate')
  if (responderPubKeys.size !== writeCertificate.length) throw new Error('Duplicate responderPubKey within writeCertificate')

  const hash = hashTransaction(transaction)
  // We have already verified all transactionHashes in writeCertificate match, so just compare the first one
  if (writeCertificate[0].transactionHash !== hash) {
    throw new Error('transactionHash mismatch; writeCertificate is not consistent with transaction')
  }

  // Verify grants maps match in each multiGrant in writeCertificate
  let grantsToCompare: Map<string, number>
  for (let i = 0; i < writeCertificate.length; i++) {
    const grants = writeCertificate[i].grants

    if (i === 0) {
      grantsToCompare = grants
      continue
    }

    if (grantsToCompare!.size !== grants.size) {
      throw new Error('Size of grants maps are inconsistent')
    }

    for (const [objectKey, timestamp] of grants.entries()) {
      const timestampToCompare = grantsToCompare!.get(objectKey)
      if (typeof timestampToCompare === 'undefined' || timestampToCompare !== timestamp) {
        throw new Error('Keys and/or values of grants maps are inconsistent')
      }
    }
  }

  // All multiGrants in writeCertificate match, now check for write contention by comparing timestamp in writeCertificate to timestamp in store
  // Note that we already have a lock on the keys in transaction
  for (const { key } of transaction) {
    const wcTimestamp = writeCertificate[0].grants.get(key)
    if (typeof wcTimestamp !== 'number') {
      // If we get here it means the transactionHash check above didn't do its job which is very bad!
      throw new Error('Key in transaction does not exist in writeCertificate')
    }

    const svoc = getKey(key)
    if (!svoc || !Array.isArray(svoc.currentCertificate)) {
      // This key has not been committed to the store before so this check is not necessary (or possible), continue to the next key
      continue
    }

    if (!svoc.currentCertificate[0] || !(svoc.currentCertificate[0].grants instanceof Map)) {
      // Store is corrupt
      // DEBUG: flag this key for a scrub
      throw new Error('Invalid currentCertificate for key in store')
    }

    const svocTimestamp = svoc.currentCertificate[0].grants.get(key)
    if (typeof svocTimestamp !== 'number') {
      // Store is corrupt
      // DEBUG: flag this key for a scrub
      throw new Error('Invalid timestamp in currentCertificate for key in store')
    }

    const { epoch: wcEpoch, subEpoch: wcSubEpoch } = numberToTimestamp(wcTimestamp)
    const { epoch: svocEpoch, subEpoch: svocSubEpoch } = numberToTimestamp(svocTimestamp)
    if (wcEpoch < svocEpoch || (wcEpoch === svocEpoch && wcSubEpoch <= svocSubEpoch)) {
      throw new Error('Timestamp in writeCertificate is behind timestamp in currentCertificate in store')
    }
  }
}

const commitWriteTransaction = async (writeCertificate: Stst.WriteCertificate, transaction: Stst.TransactionOperation[]) => {
  // Complete the validation before doing any writes to the store
  // For transaction to be invalid at this stage, 2f + 1 peers would have to be faulty, which means there is no quorum and the entire DB is compromised :S
  for (const op of transaction) {
    if (op.action === TransactionOperationAction.READ) {
      throw new Error('Read operation found in write transaction')
    }
    if (op.action === TransactionOperationAction.WRITE && typeof op.value === 'undefined') {
      throw new Error('write operation found without a value')
    }
  }

  for (const op of transaction) {
    let svoc = getKey(op.key)
    if (!svoc) {
      svoc = {
        value: null,
        valueAvailable: false,
        currentCertificate: null,
        grantHistory: new Map()
      }
    }

    svoc.currentCertificate = writeCertificate

    if (op.action === TransactionOperationAction.WRITE) {
      svoc.value = op.value as any // Already checked for undefined above
      svoc.valueAvailable =  true
    } else {
      // DELETE
      svoc.value = null
      svoc.valueAvailable = false
    }

    setKey(op.key, svoc)
  }
}

const deleteCompletedFromGrantHistory = async (writeCertificate: Stst.WriteCertificate): Promise<void> => {
  // We have already verified all the grants in the WriteCertificate match so just get the first MultiGrant
  let write1Grants: Map<string, number> = writeCertificate[0].grants

  for (const [objectKey, timestamp] of write1Grants.entries()) {
    let svoc = getKey(objectKey)
    if (!svoc) continue

    const { epoch } = numberToTimestamp(timestamp)
    const multiGrant = svoc.grantHistory.get(epoch)?.get(timestamp)
    if (!multiGrant) continue
    // We have already verified all transactionHashes within writeCertificate match
    if (multiGrant.transactionHash !== writeCertificate[0].transactionHash) continue

    svoc.grantHistory.get(epoch)!.delete(timestamp)
    setKey(objectKey, svoc)
  }
}

export const onWrite2Req = async (payload: Stst.Write2ReqMessage): Promise<Buffer> => {
  if (!initDone) throw new Error('Must call initResponderWrite1() first!')

  const transactionKeys = payload.transaction.map(({ key }) => key)

  try {
    await lockKeys(transactionKeys)
    await verifyWriteCertificate(payload.writeCertificate, payload.transaction)
    await commitWriteTransaction(payload.writeCertificate, payload.transaction)
    // If we created a MultiGrant during write1 we can now safely delete it from grantHistory
    await deleteCompletedFromGrantHistory(payload.writeCertificate)
    unlockKeys(transactionKeys)

    return serialiseMessage({
      type: ProtocolMessageType.WRITE_2_OK_RES,
      payload: { transactionHash: payload.writeCertificate[0].transactionHash }
    })
  } catch (err) {
    unlockKeys(transactionKeys)

    const message: string = err instanceof Error ? err.message : ''
    return serialiseMessage({
      type: ProtocolMessageType.WRITE_2_REFUSED_RES,
      payload: { message }
    })
  }
}

// This is how we write to our own store after sending Write2Req to the other peers
// This is called by initiator-write
export const commitWriteTransactionLocal = async (writeCertificate: Stst.WriteCertificate, transaction: Stst.TransactionOperation[]): Promise<Stst.Write2OkResMessage> => {
  if (!initDone) throw new Error('Must call initResponderWrite1() first!')
  await verifyWriteCertificate(writeCertificate, transaction)
  await commitWriteTransaction(writeCertificate, transaction)
  return { transactionHash: writeCertificate[0].transactionHash }
}
