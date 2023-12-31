import Stst from '../types'
import { ProtocolMessageType, TransactionOperationAction } from '../enums'
import { reqResInit } from '../cream'
import { lockKeys, unlockKeys, getKey, setKey, getAllKeysIterator } from '../bread'
import { initInitiatorWrite, executeWriteOrDeleteTransaction } from './initiator-write'
import { initInitiatorRead, executeReadTransaction } from './initiator-read'
import { initResponderWrite1, onWrite1Req } from './responder-write1'
import { initResponderWrite2, onWrite2Req } from './responder-write2'
import { onReadReq } from './responder-read'
import { parseMessage, serialiseMessage } from './protocol'
import { numberToTimestamp, asyncDelay } from '../common/utils'
import { initStore } from '../bread'
import { initExecute } from './execute'
import { pubKeyFromPrivKey } from './verify'
import { initTools, fullIntegrityCheck, getPeerStats } from './tools'

let gcInProgress = false
let fullIntegrityCheckInProgress = false

const garbageCollector = async () => {
  gcInProgress = true
  for (const key of getAllKeysIterator()) {
    try {
      await lockKeys([key])
      const svoc = getKey(key)
      if (!svoc || !svoc.currentCertificate || !svoc.grantHistory) {
        // This is ok, it probably just means this key was deleted between getAllKeysIterator and getKey being called
        throw new Error(`GC: no valid svoc at ${key}`)
      }

      // We have already verified all the grants in the WriteCertificate match so just use the first MultiGrant: svoc.currentCertificate[0]
      const currentTimestamp = svoc.currentCertificate[0].grants.get(key)
      if (typeof currentTimestamp !== 'number') {
        throw new Error(`GC: no currentTimestamp at ${key}`)
      }
      const { epoch: currentEpoch } = numberToTimestamp(currentTimestamp)

      for (const historyEpoch of svoc.grantHistory.keys()) {
        // Only delete Write1 MultiGrants that were given 2 or more epochs before the currentCertificate's epoch
        if (currentEpoch - historyEpoch >= 2) svoc.grantHistory.delete(historyEpoch)
      }

      setKey(key, svoc)
    } catch (err) {
      // DEBUG: log
      console.warn(err)
    }

    unlockKeys([key])
    await asyncDelay(50) // wait a bit to minimise impact on any in-progress transactions
  }
  gcInProgress = false
}

const executeTransaction = async (transaction: Stst.TransactionOperation[]): Promise<Stst.TransactionOperationResult[] | void> => {
  // type is 'read' if it only contains read actions
  // type is 'write' if it contains any mixture of write, execute and/or delete actions but no read actions
  let readOnly: boolean | null = null

  for (const op of transaction) {
    const isOpRead = op.action === TransactionOperationAction.READ
    const isOpWriteExec = op.action === TransactionOperationAction.WRITE || op.action === TransactionOperationAction.EXECUTE

    if (isOpWriteExec && !Buffer.isBuffer(op.value)) {
      throw new Error('Write/execute operations must have a Buffer value specified.')
    }

    if (readOnly === null) {
      readOnly = isOpRead
      continue
    }

    if (readOnly !== isOpRead) throw new Error('Transactions can\'t mix read operations with write/delete operations.')
  }

  if (readOnly) {
    return await executeReadTransaction(transaction)
  } else {
    return await executeWriteOrDeleteTransaction(transaction)
  }
}

// Just check the fields here, the crypto stuff with the signature will be done in initiator-write.ts
const validateMultiGrantFields = (mg: Stst.MultiGrant): string | null => {
  if (!mg) return 'must have MultiGrant'
  if (!(mg.grants instanceof Map)) return 'MultiGrant grants must be a map'
  if (typeof mg.initiatorPubKey !== 'string') return 'MultiGrant initiatorPubKey must be a string'
  if (typeof mg.responderPubKey !== 'string') return 'MultiGrant responderPubKey must be a string'
  if (typeof mg.transactionHash !== 'string') return 'MultiGrant transactionHash must be a string'
  if (typeof mg.signature !== 'string') return 'MultiGrant signature must be a string'
  return null
}

const validateTransactionOperation = (to: Stst.TransactionOperation, includesValue: boolean): string | null => {
  if (!to) return 'must have TransactionOperation'
  if (typeof to.action !== 'number') return 'TransactionOperation action must be a number'
  if (typeof to.key !== 'string') return 'TransactionOperation key must be a string'
  if (!includesValue && typeof to.value === 'undefined') return null
  if (includesValue && to.value === null) return null
  if (includesValue && Buffer.isBuffer(to.value)) return null
  return 'TransactionOperation value must be either undefined, null or Buffer'
}

// This is for initiator
export const parseRes = (message: Buffer): Stst.ProtocolMessage => {
  // This will throw if the message fails initial validation checks
  let parsedMessage = parseMessage(message)
  let payload, validationMessage

  switch (parsedMessage.type) {
    // Read

    case ProtocolMessageType.READ_RES:
      payload = parsedMessage.payload as Stst.ReadResMessage
      if (!Array.isArray(payload.results)) throw new Error('ReadRes results must be an array')
      return parsedMessage

    // Write1

    case ProtocolMessageType.WRITE_1_OK_RES:
      payload = parsedMessage.payload as Stst.Write1OkResMessage
      validationMessage = validateMultiGrantFields(payload.multiGrant)
      if (typeof validationMessage === 'string') throw new Error(`Write1OkRes ${validationMessage}`)
      return parsedMessage

    case ProtocolMessageType.WRITE_1_REFUSED_RES:
      payload = parsedMessage.payload as Stst.Write1RefusedResMessage
      if (typeof payload.message !== 'string') throw new Error('Write1RefusedRes message must be a string')
      return parsedMessage

    // Write2

    case ProtocolMessageType.WRITE_2_OK_RES:
      payload = parsedMessage.payload as Stst.Write2OkResMessage
      if (typeof payload.transactionHash !== 'string') throw new Error(`Write2OkRes transactionHash must be a string`)
      return parsedMessage

    case ProtocolMessageType.WRITE_2_REFUSED_RES:
      payload = parsedMessage.payload as Stst.Write2RefusedResMessage
      if (typeof payload.message !== 'string') throw new Error('Write2RefusedRes message must be a string')
      return parsedMessage

    // Echo

    case ProtocolMessageType.ECHO_RES:
      payload = parsedMessage.payload as Stst.EchoResMessage
      if (typeof payload.reqTime !== 'number' || typeof payload.resTime !== 'number') {
        throw new Error('EchoResMessage reqTime and resTime must be numbers')
      }
      return parsedMessage

    // Unknown

    default:
      throw new Error('Unknown ProtocolMessageType')
  }
}

// This is for responder
const onReq = async (fromPeerId: string, message: Buffer): Promise<Buffer> => {
  // This will throw if the message fails initial validation checks
  let parsedMessage = parseMessage(message)
  let payload, validationMessage
  let response: Buffer

  switch (parsedMessage.type) {
    // Read

    case ProtocolMessageType.READ_REQ:
      payload = parsedMessage.payload as Stst.ReadReqMessage
      if (!Array.isArray(payload.transaction)) throw new Error('ReadReq transaction must be an array')
      for (const op of payload.transaction) {
        validationMessage = validateTransactionOperation(op, false)
        if (typeof validationMessage === 'string') throw new Error(`ReadReq transaction ${validationMessage}`)
      }
      response = await onReadReq(payload)
      break

    // Write1

    case ProtocolMessageType.WRITE_1_REQ:
      payload = parsedMessage.payload as Stst.Write1ReqMessage
      if (!Array.isArray(payload.transaction)) throw new Error('Write1Req transaction must be an array')
      for (const op of payload.transaction) {
        validationMessage = validateTransactionOperation(op, false)
        if (typeof validationMessage === 'string') throw new Error(`Write1Req transaction ${validationMessage}`)
      }
      if (typeof payload.subEpoch !== 'number') throw new Error('Write1Req subEpoch must be a number')
      if (typeof payload.transactionHash !== 'string') throw new Error('Write1Req transactionHash must be a string')
      response = await onWrite1Req(fromPeerId, payload)
      break

    // Write2

    case ProtocolMessageType.WRITE_2_REQ:
      payload = parsedMessage.payload as Stst.Write2ReqMessage
      if (!Array.isArray(payload.writeCertificate)) throw new Error('Write2Req writeCertificate must be an array')
      for (const multiGrant of payload.writeCertificate) {
        validationMessage = validateMultiGrantFields(multiGrant)
        if (typeof validationMessage === 'string') throw new Error(`Write2Req writeCertificate ${validationMessage}`)
      }
      if (!Array.isArray(payload.transaction)) throw new Error('Write2Req transaction must be an array')
      for (const op of payload.transaction) {
        // DELETE should not have a value, WRITE/EXECUTE should
        const includesValue = op.action === TransactionOperationAction.WRITE || op.action === TransactionOperationAction.EXECUTE
        validationMessage = validateTransactionOperation(op, includesValue)
        if (typeof validationMessage === 'string') throw new Error(`Write2Req transaction ${validationMessage}`)
      }
      response = await onWrite2Req(payload)
      break

    // Echo

    case ProtocolMessageType.ECHO_REQ:
      payload = parsedMessage.payload as Stst.EchoReqMessage
      if (typeof payload.reqTime !== 'number') throw new Error('EchoReqMessage reqTime must be a number')
      response = serialiseMessage({
        type: ProtocolMessageType.ECHO_RES,
        payload: { reqTime: payload.reqTime, resTime: Date.now() }
      })
      break

    // Unknown

    default:
      throw new Error('Unknown ProtocolMessageType')
  }

  return response
}

const init = async (config: Stst.PeerConfig): Promise<void> => {
  if (config.maxFaultyPeers <= 0) throw new Error('maxFaultyPeers must be at least 1')
  if (config.peerPubKeys.length < 3 * config.maxFaultyPeers) {
    throw new Error('The total number of peers must be at least 3 * maxFaultyPeers + 1')
  }
  if (!config.peerAddrs) throw new Error('peerAddrs required')
  if (!config.appDirName) throw new Error('appDirName required')

  const myPubKey = pubKeyFromPrivKey(config.myPrivKey)

  await initExecute(config.executeTimeout)
  await initStore(config.appDirName)
  await reqResInit(config.peerAddrs.map((addr, i) => { return { addr, id: config.peerPubKeys[i] } }), onReq)
  initInitiatorRead(config.maxFaultyPeers, config.readTimeout, config.readRequestRetryCount, myPubKey, config.peerPubKeys)
  initInitiatorWrite(config.peerPubKeys, config.maxFaultyPeers, config.write1Timeout, config.write1RequestRetryCount, config.write2Timeout, config.write2RequestRetryCount)
  initResponderWrite1(myPubKey, config.myPrivKey)
  initResponderWrite2(myPubKey, config.peerPubKeys, config.maxFaultyPeers)
  initTools(myPubKey, config.peerPubKeys, config.maxFaultyPeers)

  setInterval(() => {
    if (!gcInProgress && !fullIntegrityCheckInProgress) garbageCollector()
  }, config.gcInterval)
}

const fullIntegrityCheckOnKey = (reqId: number, key: string, segments: string[][]) => {
  if (!fullIntegrityCheckInProgress) return false
  // process.send is not suddenly gonna go undefined, TS is being a dumb dumb
  // @ts-ignore
  process.send({ reqId, error: null, result: [key, segments], completed: false })
  return true
}

process.on('message', async (msg) => {
  if (!process.send) throw new Error('this module must be spawned with an IPC channel')

  if (!msg || typeof msg !== 'object') return
  const { func, args, reqId, completed } = msg as any

  try {
    if (func === 'init') {
      process.send({ reqId, error: null, result: await init(args[0]), completed: true })
    } else if (func === 'executeTransaction') {
      process.send({ reqId, error: null, result: await executeTransaction(args[0]), completed: true })
    } else if (func === 'getPeerStats') {
      process.send({ reqId, error: null, result: await getPeerStats(), completed: true })
    } else if (func === 'fullIntegrityCheck') {
      // TODO: doing the completion logic this way means fullIntegrityCheck checks one extra key
      // unnecessarily after the parent process has cancelled the check, and fullIntegrityCheckInProgress
      // is incorrectly set to false while the superfluous key is being checked (not a big deal).
      if (!completed && fullIntegrityCheckInProgress) {
        process.send({
          reqId,
          error: new Error('fullIntegrityCheck called while in progress'),
          result: null,
          completed: true
        })
        return
      }

      if (completed) {
        fullIntegrityCheckInProgress = false
        return
      }

      fullIntegrityCheckInProgress = true
      await fullIntegrityCheck(fullIntegrityCheckOnKey.bind(null, reqId))
      fullIntegrityCheckInProgress = false
      process.send({ reqId, error: null, result: undefined, completed: true })
    }
  } catch (error) {
    if (func === 'fullIntegrityCheck') fullIntegrityCheckInProgress = false

    process.send({ reqId, error, result: null, completed: true })
  }
})
