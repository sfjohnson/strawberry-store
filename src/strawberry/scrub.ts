import Stst from '../types'
import { verifyMultiGrant } from './verify'
import { lockKeys, unlockKeys, getKey, setKey } from '../bread'
import { numberToTimestamp } from '../common/utils'

let initDone = false
let _myPubKey: string
let _peerPubKeys: string[]

export const initScrub = (myPubKey: string, peerPubKeys: string[]) => {
  _myPubKey = myPubKey
  _peerPubKeys = peerPubKeys
  initDone = true
}

const verifyWriteCertificate = (writeCertificate: Stst.WriteCertificate): void => {
  const initiatorPubKeys: Set<string> = new Set()
  const responderPubKeys: Set<string> = new Set()
  const transactionHashes: Set<string> = new Set()

  for (const multiGrant of writeCertificate) {
    if (!(multiGrant.grants instanceof Map)) throw new Error('grants must be a Map')
    if (typeof multiGrant.initiatorPubKey !== 'string') throw new Error('initiatorPubKey must be a string')
    if (typeof multiGrant.responderPubKey !== 'string') throw new Error('responderPubKey must be a string')
    if (typeof multiGrant.transactionHash !== 'string') throw new Error('transactionHash must be a string')
    if (!(verifyMultiGrant(multiGrant, _peerPubKeys, _myPubKey))) throw new Error('multiGrant signature is invalid')

    initiatorPubKeys.add(multiGrant.initiatorPubKey)
    responderPubKeys.add(multiGrant.responderPubKey)
    transactionHashes.add(multiGrant.transactionHash)
  }

  if (initiatorPubKeys.size !== 1) throw new Error('initiatorPubKey mismatch within writeCertificate')
  if (transactionHashes.size !== 1) throw new Error('transactionHash mismatch within writeCertificate')
  if (responderPubKeys.size !== writeCertificate.length) throw new Error('Duplicate responderPubKey within writeCertificate')

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
}

export const onScrubFault = async (readResults: Stst.ReadOperationResult[]): Promise<void> => {
  // This is called when there is a quorum but the data in my store is different to the other peers (I have data loss or my writes are slower).
  // I need to verify the integrity of peerResults and write this into my own store.
  // NOTE: Before calling onScrubFault we have already verified that a quorum of peers has returned matching peerResults
  // NOTE: Before calling onScrubFault we have already verified every result has a currentCertificate
  // NOTE: Locks on keys in peerResults must be released before calling onScrubFault
  // DEBUG: we have no way of verifying the transactionHash in currentCertificate, so are we breaking the BFT by writing this data?

  if (!initDone) throw new Error('Must call initScrub() first!')

  const resultsKeys = readResults.map(({ key }) => key)

  try {
    await lockKeys(resultsKeys)

    for (const result of readResults) {
      const currentCertificate = result.currentCertificate!
      verifyWriteCertificate(currentCertificate)

      const multiGrant = currentCertificate[0]
      const timestamp = multiGrant.grants.get(result.key)!
      const epoch = numberToTimestamp(timestamp).epoch

      const svoc = getKey(result.key)
      let grantHistory: Map<number, Map<number, Stst.MultiGrant>>
      let multiGrantsAtEpoch: Map<number, Stst.MultiGrant>
      if (svoc) {
        grantHistory = svoc.grantHistory
        multiGrantsAtEpoch = grantHistory.get(epoch) || new Map()
      } else {
        grantHistory = new Map()
        multiGrantsAtEpoch = new Map()
      }
      multiGrantsAtEpoch.set(timestamp, multiGrant)
      grantHistory.set(epoch, multiGrantsAtEpoch)

      setKey(result.key, {
        value: result.value,
        valueAvailable: result.valueAvailable,
        currentCertificate: result.currentCertificate,
        grantHistory
      })
    }

    unlockKeys(resultsKeys)
  } catch (err) {
    unlockKeys(resultsKeys)
    throw err
  }

  // DEBUG: log
  console.log('Resolved scrub fault successfully')
}
