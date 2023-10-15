import { createHash } from 'crypto'
import { TransactionOperationAction } from '../src/enums'
import { executeTransaction } from '../src/'
import { asyncDelay } from '../src/common/utils'

const transaction = [
  {
    action: TransactionOperationAction.READ,
    key: '1234'
  }, {
    action: TransactionOperationAction.READ,
    key: '1235'
  }, {
    action: TransactionOperationAction.READ,
    key: '1236'
  }
]

export const responderEntrypoint = async (myId: string) => {
  await asyncDelay(7000)

  const result = await executeTransaction(transaction)
  if (result) {
    for (const obj of result) {
      if (!Buffer.isBuffer(obj.value)) continue
      // if (obj.value) (obj as any).value = obj.value.toString()
      const hash1 = createHash('sha256')
      hash1.update(obj.value)
      const objAny = obj as any
      objAny.value = `len: ${obj.value.length}, hash: ${hash1.digest().toString('base64')}`
    }
  }

  console.log(`Responder ${myId} transaction READ result:`, result)
}
