import Stst from '../src'
import { createHash, randomBytes } from 'crypto'
import { asyncDelay } from '../src/common/utils'
// import { reqResInit, initiateReqEach, ResCbStatus } from '../src/cream'

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
      action:  Stst.TransactionOperationAction.WRITE,
      key: '1234',
      value: Buffer.from('hello1')
    }, {
      action:  Stst.TransactionOperationAction.WRITE,
      key: '1235',
      value: Buffer.from([0x00, 0x01])
    }
  ], [
    {
      action:  Stst.TransactionOperationAction.WRITE,
      key: '1234',
      value: Buffer.from('hello3')
    }, {
      action: Stst.TransactionOperationAction.EXECUTE,
      key: '1235',
      value: Buffer.from('currentValue[0] += 1; return currentValue')
    }
  ], [
    {
      action: Stst.TransactionOperationAction.WRITE,
      key: '1234',
      value: Buffer.from('hello5')
    }, {
      action: Stst.TransactionOperationAction.WRITE,
      key: '1236',
      value: Buffer.from('hello6')
    }
  ], [
    {
      action: Stst.TransactionOperationAction.DELETE,
      key: '1234'
    }
  ], [
    {
      action: Stst.TransactionOperationAction.READ,
      key: '1234'
    }, {
      action: Stst.TransactionOperationAction.READ,
      key: '1235'
    }, {
      action: Stst.TransactionOperationAction.READ,
      key: '1236'
    }
  ]
]

export const initiatorEntrypoint = async (myId: string) => {
  // await reqResInit(peers, null)

  const bigRandomBuf = await generateRandomBuf(2000);
  (transactions[2][1] as any).value = bigRandomBuf

  const hash1 = createHash('sha256')
  hash1.update(bigRandomBuf)
  console.log('bigRandomBuf hash:', hash1.digest().toString('base64'))

  // let resCount = 0
  // console.log('result', await initiateReqEach(bigRandomBuf, (res) => {
  //   console.log('received', res[0], res.subarray(1).toString('base64'))
  //   if (++resCount === 3) {
  //     return ResCbStatus.RESOLVE
  //   }
  //   return ResCbStatus.CONTINUE
  // }))

  for (let i = 0; i < transactions.length; i++) {
    const result = await Stst.executeTransaction(transactions[i])
    if (result) {
      for (const obj of result) {
        if (!Buffer.isBuffer(obj.value)) continue
        const hash2 = createHash('sha256')
        hash2.update(obj.value)
        if (obj.value.length > 100) {
          const objAny = obj as any
          objAny.value = `len: ${obj.value.length}, hash: ${hash2.digest().toString('base64')}`
        }
      }
    }

    console.log(`Initiator ${myId} transaction ${i} result:`, result)
  }

  // wait for responders
  await asyncDelay(12000)

  console.log('integrity check results')
  // let keyCount = 0
  await Stst.fullIntegrityCheck((key, segments) => {
    console.log(key, segments)

    // if (++keyCount === 3) {
    //   Stst.fullIntegrityCheck((key2, segments2) => true).catch((err) => console.log('here', err))
    // }

    // if (++keyCount == 10) return false
    return true
  })
}
