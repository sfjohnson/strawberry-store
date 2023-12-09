import Stst from '../types'
import { parseRes } from './index'
import { lockKeys, unlockKeys, getKey, getAllKeysIterator } from '../bread'
import { ProtocolMessageType, TransactionOperationAction } from '../enums'
import { serialiseMessage } from './protocol'
import { initiateReqAll, ResCbStatus, initiateReqEach } from '../cream'
import { resultsMatch } from './initiator-read'

let initDone = false
let _myPubKey: string
let _otherPeerCount: number
let _maxFaultyPeers: number

export const initTools = (myPubKey: string, peerPubKeys: string[], maxFaultyPeers: number) => {
  _myPubKey = myPubKey
  _otherPeerCount = peerPubKeys.length
  _maxFaultyPeers = maxFaultyPeers
  initDone = true
}

// Gets for each peer:
// - the peer's current epoch time in milliseconds
// - reqres round-trip time in milliseconds
// Throws if we did not get a fault-free quantity of responses (>= otherPeerCount - maxFaultyPeers)
export const getPeerStats = async (): Promise<Stst.PeerStats[]> => {
  if (!initDone) throw new Error('Must call initTools() first!')

  const peerStats: Stst.PeerStats[] = []

  try {
    await initiateReqEach(serialiseMessage({
      type: ProtocolMessageType.ECHO_REQ,
      payload: { reqTime: Date.now() }
    }), (res, peerId) => {
      const parsedRes = parseRes(res)
      if (parsedRes.type !== ProtocolMessageType.ECHO_RES) return ResCbStatus.CONTINUE

      const { reqTime, resTime } = parsedRes.payload as Stst.EchoResMessage
      peerStats.push({
        peerId,
        peerTime: resTime,
        rtt: Date.now() - reqTime
      })

      return ResCbStatus.CONTINUE
    })
  } catch {
    // don't bother returning ResCbStatus.RESOLVE, just let initiateReqEach throw
  }

  if (peerStats.length < _otherPeerCount - _maxFaultyPeers) {
    throw new Error('Did not receive a fault-free quantity of responses')
  }

  return peerStats
}

// This function gets all keys on all peers, while a normal read only gets enough results for a quorum (f + 1).
// It can be used to check if there is segmentation on any keys. It can also identify peers that are down.
// Other transactions should not be run during the integrity check and it may take a long time. It can be
// cancelled by returning false from the callback.
// If fullIntegrityCheck is called while a check is running an error will be thrown. Garbage collection is
// paused while the check is running.
export const fullIntegrityCheck = async (onKeyCb: (key: string, segments: string[][]) => boolean) => {
  if (!initDone) throw new Error('Must call initTools() first!')

  for (const key of getAllKeysIterator()) {
    const readReqMessage: Stst.ReadReqMessage = {
      transaction: [{
        action: TransactionOperationAction.READ,
        key
      }]
    }

    const responses = await initiateReqAll(serialiseMessage({
      type: ProtocolMessageType.READ_REQ,
      payload: readReqMessage,
    }))

    const resultSegments = new Map<Stst.ReadOperationResult, string[]>()
    let nullSegment = []

    // apply responses to segments
    for (const { res, peerId } of responses) {
      if (res === null) {
        nullSegment.push(peerId)
        continue
      }

      const parsedRes = parseRes(res)
      if (parsedRes.type !== ProtocolMessageType.READ_RES) {
        nullSegment.push(peerId)
        continue
      }

      const resMessage = parsedRes.payload as Stst.ReadResMessage
      if (resMessage.results.length !== 1) { // very unlikely
        nullSegment.push(peerId)
        continue
      }

      const resResult = resMessage.results[0]
      let match = false
      for (const [segmentResult, peerIds] of resultSegments.entries()) {
        if (resultsMatch([segmentResult], [resResult])) {
          resultSegments.set(segmentResult, [...peerIds, peerId])
          match = true
          break
        }
      }

      if (!match) resultSegments.set(resResult, [peerId])
    }

    // now apply my local store to segments
    let myResult: Stst.ReadOperationResult | null = null
    try {
      await lockKeys([key])
      const svoc = getKey(key)
      if (svoc) {
        myResult = {
          key,
          value: svoc.value,
          valueAvailable: svoc.valueAvailable,
          currentCertificate: svoc.currentCertificate
        }
      }
    } catch {
    }

    unlockKeys([key])
    if (myResult === null) {
      nullSegment.push(_myPubKey)
    } else {
      let match = false
      for (const [segmentResult, peerIds] of resultSegments.entries()) {
        if (resultsMatch([segmentResult], [myResult])) {
          resultSegments.set(segmentResult, [...peerIds, _myPubKey])
          match = true
          break
        }
      }

      if (!match) resultSegments.set(myResult, [_myPubKey])
    }

    let segments: string[][] = [...resultSegments.values()]
    if (nullSegment.length > 0) segments.push(nullSegment)

    if (!onKeyCb(key, segments)) break
  }
}
