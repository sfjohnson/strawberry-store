// In a client-server model this would be the client

import Stst from '../types'
import { ProtocolMessageType } from '../enums'
import { parseRes } from './index'
import { lockKeys, unlockKeys, getKey } from '../bread'
import { ResCbStatus, initiateReqEach } from '../cream'
import { serialiseMessage } from './protocol'
import { asyncDelay } from '../common/utils'
import { onScrubFault, initScrub } from './scrub'

let initDone = false
// config
let _maxFaultyPeers: number
let _timeout: number
let _reqRetryCount: number

const writeCertificatesMatch = (a: Stst.WriteCertificate, b: Stst.WriteCertificate): boolean => {
  // This peer has done verifyWriteCertificate() during Write 2 before storing the certificate.
  // If all the other peers match this peer's stored write certificate, then they are all verified without
  // re-validating signatures etc.
  // If this peer's stored write certificate does not match, this trust chain is broken and we must
  // re-verify all write certificates as part of the scrub process.
  if (a.length !== 2 * _maxFaultyPeers + 1 || b.length !== 2 * _maxFaultyPeers + 1) return false

  for (let i = 0; i < a.length; i++) {
    if (a[i].responderPubKey !== b[i].responderPubKey) return false
    if (a[i].signature !== b[i].signature) return false
    // If the signatures match and are valid (see above) then the grants and transaction hashes also match
  }

  return true
}

export const resultsMatch = (a: Stst.ReadOperationResult[], b: Stst.ReadOperationResult[]): boolean => {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    if ((a[i].valueAvailable && a[i].currentCertificate === null) ||
      (b[i].valueAvailable && b[i].currentCertificate === null)) {
      throw new Error('Read result has a value without a currentCertificate')
    }

    if (a[i].key !== b[i].key) return false
    if (a[i].valueAvailable !== b[i].valueAvailable) return false
    
    if (a[i].value === null) {
      if (b[i].value !== null) return false
    } else {
      if (b[i].value === null) return false
      if (Buffer.compare(a[i].value as Buffer, b[i].value as Buffer) !== 0) return false
    }

    if (a[i].currentCertificate === null) {
      if (b[i].currentCertificate !== null) return false
    } else {
      if (b[i].currentCertificate === null) return false
      if (!writeCertificatesMatch(a[i].currentCertificate as Stst.WriteCertificate, b[i].currentCertificate as Stst.WriteCertificate)) return false
    }
  }

  return true
}

export const initInitiatorRead = (maxFaultyPeers: number, timeout: number, reqRetryCount: number, myPubKey: string, peerPubKeys: string[]) => {
  _maxFaultyPeers = maxFaultyPeers
  _timeout = timeout
  _reqRetryCount = reqRetryCount
  initScrub(myPubKey, peerPubKeys)
  initDone = true
}

const sendReadReqOnce = async (transaction: Stst.TransactionOperation[]): Promise<Stst.ReadOperationResult[] | null> => {
  const readReqMessage: Stst.ReadReqMessage = {
    transaction
  }

  // If we get _maxFaultyPeers peers that match this peer's stored write certificate, that is sufficient for a read as it
  // meets the f + 1 requirement, but if this peer's stored write certificate does not match we will not be able to do
  // the scrub process as we now have only f not f + 1. Therefore we always require _maxFaultyPeers + 1 remote peers so
  // we can scrub if necessary.
  const requiredPeerCount = _maxFaultyPeers + 1

  // For each received list of read operation results, check if it matches the others. If it doesn't match, add it to a new
  // segment. If it matches an existing segment, add it there. If any segment reaches requiredPeerCount that segment has a
  // quorum and we return those results and discard the other results.
  const resultsSegments = new Map<Stst.ReadOperationResult[], number>()
  let resultsQuorum: Stst.ReadOperationResult[] | null = null

  try {
    await initiateReqEach(serialiseMessage({
      type: ProtocolMessageType.READ_REQ,
      payload: readReqMessage,
    }), (resBuf) => {
      try {
        const parsedRes = parseRes(resBuf)
        if (parsedRes.type !== ProtocolMessageType.READ_RES) return ResCbStatus.CONTINUE 
        const resMessage = parsedRes.payload as Stst.ReadResMessage

        let match = false
        for (const [results, count] of resultsSegments.entries()) {
          if (resultsMatch(results, resMessage.results)) {
            resultsSegments.set(results, count + 1)
            if (count + 1 === requiredPeerCount) {
              resultsQuorum = results
            } else {
              match = true
            }
            break
          }
        }

        if (resultsQuorum !== null) return ResCbStatus.RESOLVE
        if (!match) resultsSegments.set(resMessage.results, 1)
        return ResCbStatus.CONTINUE 
      } catch {
        return ResCbStatus.CONTINUE 
      }
    })
  } catch (err) {
    // DEBUG: log
    console.error('read', err)
  }

  if (resultsQuorum === null) {
    // delay before retrying request
    await asyncDelay(_timeout)
    return null
  }

  return resultsQuorum
}

// NOTE: reading objects that have not been written to before (null currentCertificate) is not permitted
export const executeReadTransaction = async (transaction: Stst.TransactionOperation[]): Promise<Stst.TransactionOperationResult[]> => {
  if (!initDone) throw new Error('Must call initInitiatorRead() first!')
  
  let results: Stst.ReadOperationResult[] | null = null
  for (let i = 0; i < _reqRetryCount + 1; i++) {
    results = await sendReadReqOnce(transaction)
    if (results !== null) break
  }

  if (results === null) throw new Error(`Read request${_reqRetryCount > 0 ? 's' : ''} failed`)

  for (const result of results) {
    if (result.currentCertificate === null) {
      throw new Error('Read transaction contains object(s) that have not yet been written')
    }
  }

  // The peers match, now read from my own store and compare to peers
  const transactionKeys = transaction.map(({ key }) => key)
  let myResults: Stst.ReadOperationResult[]
  try {
    await lockKeys(transactionKeys)
    // TODO: remove await Promise.all and async here
    myResults = await Promise.all(transaction.map(async (op) => {
      const svoc = getKey(op.key)
      if (!svoc) {
        return { key: op.key, value: null, valueAvailable: false, currentCertificate: null }
      }
      return {
        key: op.key,
        value: svoc.value,
        valueAvailable: svoc.valueAvailable,
        currentCertificate: svoc.currentCertificate
      }
    }))
  } catch (err) {
    unlockKeys(transactionKeys)
    throw err
  }

  unlockKeys(transactionKeys)

  if (!resultsMatch(results, myResults)) onScrubFault(results)

  return results.map(({ key, valueAvailable, value }) => {
    return {
      key,
      value: valueAvailable ? value : null
    }
  })
}
