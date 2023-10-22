import { createHash } from 'crypto'
import Stst from '../src'
import { asyncDelay } from '../src/common/utils'

const transaction = [
  {
    action: Stst.TransactionOperationAction.READ,
    key: '1234'
  }, {
    action: Stst.TransactionOperationAction.READ,
    key: '1235'
  }, {
    action: Stst.TransactionOperationAction.READ,
    key: 'hello'
  }, {
    action: Stst.TransactionOperationAction.READ,
    key: '1236'
  }
]

export const responderEntrypoint = async (myId: string) => {
  await asyncDelay(7000)

  const result = await Stst.executeTransaction(transaction)
  if (result) {
    for (const obj of result) {
      if (!Buffer.isBuffer(obj.value)) continue
      const hash1 = createHash('sha256')
      hash1.update(obj.value)
      if (obj.value.length > 100) {
        const objAny = obj as any
        objAny.value = `len: ${obj.value.length}, hash: ${hash1.digest().toString('base64')}`
      }
    }
  }

  console.log(`Responder ${myId} transaction READ result:`, result)
}
