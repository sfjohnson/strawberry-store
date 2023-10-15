// In a client-server model this would be the server

import { ProtocolMessageType } from '../enums'
import { lockKeys, getKey, unlockKeys } from '../bread'
import { serialiseMessage } from './protocol'

export const onReadReq = async (payload: Stst.ReadReqMessage): Promise<Buffer> => {
  const transactionKeys = payload.transaction.map(({ key }) => key)
  let results: Stst.ReadOperationResult[]

  try {
    await lockKeys(transactionKeys)

    results = await Promise.all(payload.transaction.map(async (op) => {
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
  
  return serialiseMessage({
    type: ProtocolMessageType.READ_RES,
    payload: { results }
  })
}
