// In a client-server model this would be the client

import { ProtocolMessageType } from '../enums'
import { parseRes } from './index'
import { initiateReqSome } from '../cream'
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

  const validResMessages: Stst.Write1OkResMessage[] = []
  try {
    await initiateReqSome(serialiseMessage({
      type: ProtocolMessageType.WRITE_1_REQ,
      payload: write1ReqMessage
    }), requiredPeerCount, (resBuf) => {
      try {
        const parsedRes = parseRes(resBuf)
        // Check if we received an erroneous Write2Res, or we received Write1RefusedRes
        // TODO: Write1RefusedRes will contain an error message which we should not discard
        if (parsedRes.type !== ProtocolMessageType.WRITE_1_OK_RES) return false
        validResMessages.push(parsedRes.payload as Stst.Write1OkResMessage)
        return true
      } catch {
        return false
      }
    })
  } catch {
  }

  if (validResMessages.length !== requiredPeerCount) {
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
    await initiateReqSome(serialiseMessage({
      type: ProtocolMessageType.WRITE_2_REQ,
      payload: write2ReqMessage
    }), requiredPeerCount, (resBuf) => {
      try {
        const parsedRes = parseRes(resBuf)
        // Check if we received an erroneous Write1Res, or we received Write2RefusedRes
        if (parsedRes.type !== ProtocolMessageType.WRITE_2_OK_RES) return false
        validResMessages.push(parsedRes.payload as Stst.Write2OkResMessage)
        return true
      } catch {
        return false
      }
    })
  } catch {
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

  const writeCertificate: Stst.WriteCertificate = []

  // Validate Write1 responses using the multiGrant signatures
  let grantsToCompare: Map<string, number>
  for (let i = 0; i < write1OkResMessages.length; i++) {
    const res = write1OkResMessages[i]
    // No need to test against myPubKey
    if (!(await verifyMultiGrant(res.multiGrant, _peerPubKeys))) {
      throw new Error('Write1 received MultiGrant has invalid signature')
    }

    const grants = res.multiGrant.grants
    writeCertificate.push(res.multiGrant)

    if (i === 0) {
      grantsToCompare = grants
      continue
    }

    if (grantsToCompare!.size !== grants.size) {
      throw new Error('Write1 received grants are inconsistent')
    }

    for (const [objectKey, timestamp] of grants.entries()) {
      const timestampToCompare = grantsToCompare!.get(objectKey)
      if (typeof timestampToCompare === 'undefined' || timestampToCompare !== timestamp) {
        throw new Error('Write1 received grants are inconsistent')
      }
    }
  }

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
