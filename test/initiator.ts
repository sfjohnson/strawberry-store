import { createHash, randomBytes } from 'crypto'
import { TransactionOperationAction } from '../src/enums'
import { executeTransaction } from '../src/'

const generateRandomBuf = (length: number): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    randomBytes(length, (err, buf) => {
      if (err) {
        reject(err)
      } else {
        resolve(buf)
      }
    })
  })
}

const transactions = [
  [
    {
      action: TransactionOperationAction.WRITE,
      key: '1234',
      value: Buffer.from('hello1')
    }, {
      action: TransactionOperationAction.WRITE,
      key: '1235',
      value: Buffer.from('hello2')
    }
  ], [
    {
      action: TransactionOperationAction.WRITE,
      key: '1234',
      value: Buffer.from('hello3')
    }, {
      action: TransactionOperationAction.WRITE,
      key: '1235',
      value: Buffer.from('hello4')
    }
  ], [
    {
      action: TransactionOperationAction.WRITE,
      key: '1234',
      value: Buffer.from('hello5')
    }, {
      action: TransactionOperationAction.WRITE,
      key: '1236',
      value: Buffer.from('hello6')
    }
  ], [
    {
      action: TransactionOperationAction.DELETE,
      key: '1234'
    }
  ], [
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
]

export const initiatorEntrypoint = async (myId: string) => {
  const bigRandomBuf = await generateRandomBuf(2000);
  (transactions[2][1] as any).value = bigRandomBuf

  const hash1 = createHash('sha256')
  hash1.update(bigRandomBuf)
  console.log('bigRandomBuf hash:', hash1.digest().toString('base64'))

  for (let i = 0; i < transactions.length; i++) {
    const result = await executeTransaction(transactions[i])
    if (result) {
      for (const obj of result) {
        if (!Buffer.isBuffer(obj.value)) continue
        const hash2 = createHash('sha256')
        hash2.update(obj.value)
        const objAny = obj as any
        objAny.value = `len: ${obj.value.length}, hash: ${hash2.digest().toString('base64')}`
      }
    }

    console.log(`Initiator ${myId} transaction ${i} result:`, result)
  }
}
