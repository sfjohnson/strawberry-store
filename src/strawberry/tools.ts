import Stst from '../types'
import { parseRes } from './index'
import { lockKeys, unlockKeys, getKey, getAllKeysIterator } from '../bread'
import { ProtocolMessageType, TransactionOperationAction } from '../enums'
import { serialiseMessage } from './protocol'
import { initiateReqAll } from '../cream'
import { resultsMatch } from './initiator-read'

// This function gets all keys on all peers, while a normal read only gets enough results for a quorum (f + 1).
// It can be used to check if there is segmentation on any keys. It can also identify peers that are down.
// Other transactions should not be run during the integrity check and it may take a long time. It can be
// cancelled by returning false from the callback.
// If fullIntegrityCheck is called while a check is running an error will be thrown. Garbage collection is
// paused while the check is running.
export const fullIntegrityCheck = async (onKeyCb: (key: string, segments: number[]) => boolean) => {
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

    const resultSegments = new Map<Stst.ReadOperationResult, number>()
    let nullSegment = 0

    // apply responses to segments
    for (const resBuf of responses) {
      if (resBuf === null) {
        nullSegment++
        continue
      }

      const parsedRes = parseRes(resBuf)
      if (parsedRes.type !== ProtocolMessageType.READ_RES) {
        nullSegment++
        continue
      }

      const resMessage = parsedRes.payload as Stst.ReadResMessage
      if (resMessage.results.length !== 1) { // very unlikely
        nullSegment++
        continue
      }

      const resResult = resMessage.results[0]
      let match = false
      for (const [segmentResult, count] of resultSegments.entries()) {
        if (resultsMatch([segmentResult], [resResult])) {
          resultSegments.set(segmentResult, count + 1)
          match = true
          break
        }
      }

      if (!match) resultSegments.set(resResult, 1)
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
      nullSegment++
    } else {
      let match = false
      for (const [segmentResult, count] of resultSegments.entries()) {
        if (resultsMatch([segmentResult], [myResult])) {
          resultSegments.set(segmentResult, count + 1)
          match = true
          break
        }
      }

      if (!match) resultSegments.set(myResult, 1)
    }

    let segments: number[] = [...resultSegments.values()]
    if (nullSegment > 0) segments.push(nullSegment)

    if (!onKeyCb(key, segments)) break
  }
}
