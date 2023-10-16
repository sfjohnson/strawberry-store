// In a client-server model this would be the server

import Stst from '../types'
import { ProtocolMessageType, TransactionOperationAction } from '../enums'
import { lockKeys, unlockKeys, getKey, setKey } from '../bread'
import { serialiseMessage } from './protocol'
import { timestampToNumber, numberToTimestamp } from '../common/utils'
import { signMultiGrant } from './verify'

let initDone = false
let _myPubKey: string
let _myPrivKey: string

export const initResponderWrite1 = (myPubKey: string, myPrivKey: string) => {
  _myPubKey = myPubKey
  _myPrivKey = myPrivKey
  initDone = true
}

const getObjectCurrentTimestamp = (key: string, svoc: Stst.StoreValueObjectContainer): number => {
  if (!svoc.currentCertificate || svoc.currentCertificate.length === 0) {
    throw new Error('Could not get timestamp: currentCertificate empty or null')
  }

  // Assume all MultiGrants have consistent timestamps
  // DEBUG: is this OK to assume?
  const timestamp = svoc.currentCertificate[0].grants.get(key)
  if (typeof timestamp !== 'number') {
    throw new Error('Could not get timestamp: could not find key')
  }

  return timestamp
}

export const onWrite1Req = async (fromPeerPubKey: string, payload: Stst.Write1ReqMessage): Promise<Buffer> => {
  if (!initDone) throw new Error('Must call initResponderWrite1() first!')
  
  const write1MultiGrant: Stst.MultiGrant = {
    grants: new Map(),
    initiatorPubKey: fromPeerPubKey,
    responderPubKey: _myPubKey,
    transactionHash: payload.transactionHash,
    signature: ''
  }

  const transactionKeys = payload.transaction.map(({ key }) => key)

  try {
    await lockKeys(transactionKeys)
    for (const { key, action } of payload.transaction) {
      if (action === TransactionOperationAction.READ) throw new Error('Read operation found in write transaction')

      let nextTimestamp: number
      const svoc = getKey(key)

      if (svoc && svoc.currentCertificate) {
        // currentCertificate has already been checked for consistency, so we know for each responderId each corresponding object epoch will be the same,
        // so just use the MultiGrant from the first peer in the WriteCertificate.
        let currentEpoch: number = numberToTimestamp(getObjectCurrentTimestamp(key, svoc)).epoch
        nextTimestamp = timestampToNumber({ epoch: currentEpoch + 1, subEpoch: payload.subEpoch })

        const existingMultiGrant = svoc.grantHistory.get(currentEpoch + 1)?.get(nextTimestamp)
        if (existingMultiGrant) {
          if (existingMultiGrant.initiatorPubKey === fromPeerPubKey && existingMultiGrant.transactionHash === payload.transactionHash) {
            // The same initiator is asking for the same transaction so it must have dropped the previous Write1Ok we sent, so resend it
            unlockKeys(transactionKeys)
            return serialiseMessage({
              type: ProtocolMessageType.WRITE_1_OK_RES,
              payload: { multiGrant: existingMultiGrant }
            })
          } else {
            throw new Error('Another initiator has a grant at this timestamp')
          }
        }
      } else {
        // There is no existing current write certificate for this object so start from epoch 1
        nextTimestamp = timestampToNumber({ epoch: 1, subEpoch: payload.subEpoch })
      }

      write1MultiGrant.grants.set(key, nextTimestamp)
    }

    await signMultiGrant(write1MultiGrant, _myPrivKey)

    // All of the objects in the transaction are valid to be written and write1MultiGrant has been made, so we can now add to (or create) grantHistory
    for (const { key } of payload.transaction) {
      const nextTimestamp = write1MultiGrant.grants.get(key)!
      const nextEpoch = numberToTimestamp(nextTimestamp).epoch

      const svoc = getKey(key)
      if (svoc) {
        const multiGrantsAtEpoch = svoc.grantHistory.get(nextEpoch)
        if (multiGrantsAtEpoch) {
          multiGrantsAtEpoch.set(nextTimestamp, write1MultiGrant)
        } else {
          const newMultiGrantMap: Map<number, Stst.MultiGrant> = new Map()
          newMultiGrantMap.set(nextTimestamp, write1MultiGrant)
          svoc.grantHistory.set(nextEpoch, newMultiGrantMap)
        }
        setKey(key, svoc)
      } else {
        const newGrantHistory: Map<number, Map<number, Stst.MultiGrant>> = new Map()
        const newMultiGrantMap: Map<number, Stst.MultiGrant> = new Map()
        newMultiGrantMap.set(nextTimestamp, write1MultiGrant)
        newGrantHistory.set(nextEpoch, newMultiGrantMap)
        setKey(key, {
          value: null,
          valueAvailable: false,
          currentCertificate: null,
          grantHistory: newGrantHistory
        })
      }
    }

    unlockKeys(transactionKeys)

    return serialiseMessage({
      type: ProtocolMessageType.WRITE_1_OK_RES,
      payload: { multiGrant: write1MultiGrant }
    })
  } catch (err) {
    unlockKeys(transactionKeys)

    const message: string = err instanceof Error ? err.message : ''
    return serialiseMessage({
      type: ProtocolMessageType.WRITE_1_REFUSED_RES,
      payload: { message }
    })
  }
}
