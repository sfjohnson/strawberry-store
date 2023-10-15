// In a client-server model this would be the client

import { ProtocolMessageType } from '../enums'
import { parseRes } from './index'
import { lockKeys, unlockKeys, getKey } from '../bread'
import { initiateReqSome } from '../cream'
import { serialiseMessage } from './protocol'
import { asyncDelay } from '../common/utils'
import { onScrubError } from './scrub'

let initDone = false
// config
let _maxFaultyPeers: number
let _timeout: number
let _reqRetryCount: number

const writeCertificatesMatch = (a: Stst.WriteCertificate, b: Stst.WriteCertificate): boolean => {
  // This peer has done verifyWriteCertificate() during Write 2 before storing the certificate.
  // If all the other peers match this peer's stored write certificate, then they are all verified without
  // re-validating signatures etc.
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    if (a[i].responderPubKey !== b[i].responderPubKey) return false
    if (a[i].signature !== b[i].signature) return false
    // If the signatures match and are valid (see above) then the grants must match
  }

  return true
}

const resultsMatch = (a: Stst.ReadOperationResult[], b: Stst.ReadOperationResult[]): boolean => {
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

export const initInitiatorRead = (maxFaultyPeers: number, timeout: number, reqRetryCount: number) => {
  _maxFaultyPeers = maxFaultyPeers
  _timeout = timeout
  _reqRetryCount = reqRetryCount
  initDone = true
}

const sendReadReqOnce = async (transaction: Stst.TransactionOperation[]): Promise<Stst.ReadOperationResult[] | null> => {
  const readReqMessage: Stst.ReadReqMessage = {
    transaction
  }

  // DEBUG: do we need to wait for f + 1 or only f peers?
  const requiredPeerCount = _maxFaultyPeers + 1

  let validResultsCount = 0
  let matchingResults: Stst.ReadOperationResult[] | null = null
  try {
    await initiateReqSome(serialiseMessage({
      type: ProtocolMessageType.READ_REQ,
      payload: readReqMessage,
    }), requiredPeerCount, (resBuf) => {
      try {
        const parsedRes = parseRes(resBuf)
        if (parsedRes.type !== ProtocolMessageType.READ_RES) return false
        const resMessage = parsedRes.payload as Stst.ReadResMessage

        if (matchingResults === null || resultsMatch(matchingResults, resMessage.results)) {
          matchingResults = resMessage.results
          validResultsCount++
          return true
        }
        return false
      } catch {
        return false
      }
    })
  } catch {
  }

  if (validResultsCount !== requiredPeerCount) {
    // delay before retrying request
    await asyncDelay(_timeout)
    return null
  }

  return matchingResults
}

export const executeReadTransaction = async (transaction: Stst.TransactionOperation[]): Promise<Stst.TransactionOperationResult[]> => {
  if (!initDone) throw new Error('Must call initInitiatorRead() first!')
  
  let results: Stst.ReadOperationResult[] | null = null
  for (let i = 0; i < _reqRetryCount + 1; i++) {
    results = await sendReadReqOnce(transaction)
    if (results !== null) break
  }

  if (results === null) throw new Error(`Read request${_reqRetryCount > 0 ? 's' : ''} failed`)

  // The peers match, now read from my own store and compare to peers
  const transactionKeys = transaction.map(({ key }) => key)
  let myResults: Stst.ReadOperationResult[]
  try {
    await lockKeys(transactionKeys)
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

  if (!resultsMatch(results, myResults)) return onScrubError(results)

  return results.map(({ key, valueAvailable, value }) => {
    return {
      key,
      value: valueAvailable ? value : null
    }
  })
}
