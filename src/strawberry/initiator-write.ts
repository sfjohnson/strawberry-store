// In a client-server model this would be the client

import Stst from '../types'
import { ProtocolMessageType } from '../enums'
import { parseRes } from './index'
import { ResCbStatus, initiateReqEach } from '../cream'
import { generateSubEpoch, asyncDelay } from '../common/utils'
import { hashTransaction, verifyMultiGrant } from './verify'
import { serialiseMessage } from './protocol'
import { commitWriteTransactionLocal } from './responder-write2'

let initDone = false
// config
let _peerPubKeys: string[]
let _maxFaultyPeers: number
let _write1Timeout: number, _write2Timeout: number
let _write1ReqRetryCount: number, _write2ReqRetryCount: number

export const initInitiatorWrite = (
  peerPubKeys: string[],
  maxFaultyPeers: number,
  write1Timeout: number,
  write1RequestRetryCount: number,
  write2Timeout: number,
  write2RequestRetryCount: number
) => {
  _peerPubKeys = peerPubKeys
  _maxFaultyPeers = maxFaultyPeers
  _write1Timeout = write1Timeout
  _write2Timeout = write2Timeout
  _write1ReqRetryCount = write1RequestRetryCount
  _write2ReqRetryCount = write2RequestRetryCount
  initDone = true
}

const write1ResConsistent = (a: Stst.Write1OkResMessage, b: Stst.Write1OkResMessage): boolean => {
  if (a.multiGrant.grants.size !== b.multiGrant.grants.size) return false // Write1 received grants are inconsistent

  for (const [objectKey, timestamp] of a.multiGrant.grants.entries()) {
    const timestampToCompare = b.multiGrant.grants.get(objectKey)
    if (typeof timestampToCompare === 'undefined' || timestampToCompare !== timestamp) return false
  }

  return true
}

const sendWrite1ReqOnce = async (transaction: Stst.TransactionOperation[]): Promise<Stst.Write1OkResMessage[] | null> => {
  const write1ReqMessage: Stst.Write1ReqMessage = {
    // Write1Req transaction doesn't need values, only action and key
    transaction: transaction.map((op) => {
      return { action: op.action, key: op.key }
    }),
    subEpoch: await generateSubEpoch(),
    // Hash entire transaction including values
    transactionHash: hashTransaction(transaction)
  }

  // DEBUG: Since we aren't adding our own MultiGrant to the WriteCertificate, but we are committing the transaction
  // to our own store after verifying the other peer's MultiGrants, do we need to wait for 2*f + 1 or only 2*f peers?
  const requiredPeerCount = 2 * _maxFaultyPeers + 1

  // Try to match each received Write1OkResMessage; hopefully they all match with each other. If one doesn't match,
  // add another segment to resMessageSegments and put it there. If any segment gets to requiredPeerCount messages,
  // that segment wins and we can proceed. If we get to _peerPubKeys.length settled requests (responses or timeouts)
  // and no segment contains requiredPeerCount messages, there is no quorum and the request has failed.
  const resMessageSegments: Stst.Write1OkResMessage[][] = []
  let validResMessages: Stst.Write1OkResMessage[] | null = null

  try {
    await initiateReqEach(serialiseMessage({
      type: ProtocolMessageType.WRITE_1_REQ,
      payload: write1ReqMessage
    }), (resBuf) => {
      try {
        const parsedRes = parseRes(resBuf)
        // Check if we received an erroneous Write2Res, or we received Write1RefusedRes
        // TODO: Write1RefusedRes will contain an error message which we should not discard
        if (parsedRes.type !== ProtocolMessageType.WRITE_1_OK_RES) return ResCbStatus.CONTINUE

        const message = parsedRes.payload as Stst.Write1OkResMessage
        // No need to test against myPubKey
        if (!verifyMultiGrant(message.multiGrant, _peerPubKeys)) return ResCbStatus.CONTINUE

        let match = false
        for (const segment of resMessageSegments) {
          if (write1ResConsistent(segment[segment.length-1], message)) {
            segment.push(message)
            if (segment.length === requiredPeerCount) {
              validResMessages = segment
              return ResCbStatus.RESOLVE
            }
            match = true
          }
        }

        if (!match) resMessageSegments.push([message])
        return ResCbStatus.CONTINUE 
      } catch {
        return ResCbStatus.CONTINUE 
      }
    })
  } catch (err) {
    // DEBUG: log
    console.error('write1', err)
  }

  if (validResMessages === null) {
    // delay before retrying request
    await asyncDelay(_write1Timeout)
    return null
  }

  // payload fields have already been validated
  return validResMessages
}

const sendWrite2ReqOnce = async (writeCertificate: Stst.WriteCertificate, transaction: Stst.TransactionOperation[]): Promise<Stst.Write2OkResMessage[] | null> => {
  const write2ReqMessage: Stst.Write2ReqMessage = {
    writeCertificate,
    // Write2Req transaction needs full transaction including values
    transaction
  }

  const requiredPeerCount = 2 * _maxFaultyPeers + 1
  const validResMessages: Stst.Write2OkResMessage[] = []

  try {
    await initiateReqEach(serialiseMessage({
      type: ProtocolMessageType.WRITE_2_REQ,
      payload: write2ReqMessage
    }), (resBuf) => {
      try {
        const parsedRes = parseRes(resBuf)
        // Check if we received an erroneous Write1Res, or we received Write2RefusedRes
        // TODO: Write2RefusedRes will contain an error message which we should not discard
        if (parsedRes.type !== ProtocolMessageType.WRITE_2_OK_RES) return ResCbStatus.CONTINUE
        validResMessages.push(parsedRes.payload as Stst.Write2OkResMessage)
        if (validResMessages.length === requiredPeerCount) return ResCbStatus.RESOLVE
        return ResCbStatus.CONTINUE
      } catch {
        return ResCbStatus.CONTINUE
      }
    })
  } catch (err) {
    // DEBUG: log
    console.error('write2', err)
  }

  if (validResMessages.length !== requiredPeerCount) {
    await asyncDelay(_write2Timeout)
    return null
  }

  return validResMessages
}

export const executeWriteOrDeleteTransaction = async (transaction: Stst.TransactionOperation[]): Promise<void> => {
  if (!initDone) throw new Error('Must call initInitiatorWrite() first!')

  // Write1

  // Wait at most _write1Timeout milliseconds to receive a quorum of responses, and if this fails try again with a different
  // subEpoch and reqId. If a quorum is not reached, any previously valid responses are discarded before retrying.
  let write1OkResMessages: Stst.Write1OkResMessage[] | null = null
  for (let i = 0; i < _write1ReqRetryCount + 1; i++) {
    write1OkResMessages = await sendWrite1ReqOnce(transaction)
    if (write1OkResMessages !== null) break
  }

  if (write1OkResMessages === null) throw new Error(`Write1 request${_write1ReqRetryCount > 0 ? 's' : ''} timed out or failed`)

  const writeCertificate: Stst.WriteCertificate = write1OkResMessages.map(({ multiGrant }) => multiGrant)

  // Write2

  // Only the reqId needs to change between retries 
  let write2OkResMessages: Stst.Write2OkResMessage[] | null = null
  for (let i = 0; i < _write2ReqRetryCount + 1; i++) {
    write2OkResMessages = await sendWrite2ReqOnce(writeCertificate, transaction)
    if (write2OkResMessages !== null) break
  }

  if (write2OkResMessages === null) {
    // TODO: check Write2RefusedRes error message and if possible go back and retry Write1
    throw new Error(`Write2 request${_write2ReqRetryCount > 0 ? 's' : ''} timed out or failed`)
  }

  write2OkResMessages.push(await commitWriteTransactionLocal(writeCertificate, transaction))

  // DEBUG: verifying that the transaction has completed successfully by comparing returned
  // transaction hashes is not part of the original MochiDB paper. Is this useful or necessary?
  let hashToCompare: string
  for (let i = 0; i < write2OkResMessages.length; i++) {
    const message = write2OkResMessages[i] as Stst.Write2OkResMessage
    if (typeof message.transactionHash !== 'string') {
      throw new Error('Received invalid Write2 response')
    }

    if (i === 0) {
      hashToCompare = message.transactionHash
      continue
    }

    if (message.transactionHash !== hashToCompare!) {
      throw new Error('Received Write2 hashes are inconsistent')
    }
  }
}
