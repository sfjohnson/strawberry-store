import Stst from './types'
import { TransactionOperationAction } from './enums'
import { fork } from 'child_process'
import { URL } from 'url'
import path from 'path'
import { generateReqId } from './common/utils'

const DELETION_INTERVAL = 30000 // ms
const LOG_FUNC_TIME = true // DEBUG: log

interface Request {
  func: string
  args: any[]
  reqId: number
  time: bigint
  markedForDeletion: boolean
  onRes: {
    resolve: (response: any) => void
    reject: (reason?: any) => void
  }
}

interface Response {
  reqId: number
  error: Error | null
  result: any
}

let childPath: any
if (typeof require !== 'undefined') { // cjs
  childPath = path.join(__dirname, 'strawberry/index.cjs')
} else { // es
  childPath = new URL(import.meta.resolve('./strawberry'))
}

// NOTE: child_process.fork accepts string or URL, @types/node is incorrect
const child = fork(childPath, { serialization: 'advanced' }) // uses v8 serialisation

const currentRequests: Request[] = []

setInterval(() => {
  for (let i = currentRequests.length - 1; i >= 0; i--) {
    const req = currentRequests[i]
    if (req.markedForDeletion) {
      console.error(`warning: request timeout for func ${req.func}`, req.args)
      currentRequests.splice(i, 1)
    } else {
      req.markedForDeletion = true
    }
  }
}, DELETION_INTERVAL)

const addReq = (func: string, args: any[]): Promise<any> => {
  return new Promise(async (resolve, reject) => {
    const req: Request = {
      func,
      args,
      time: process.hrtime.bigint(),
      markedForDeletion: false,
      reqId: await generateReqId(),
      onRes: { resolve, reject }
    }

    child.send({ func, args: req.args, reqId: req.reqId })
    currentRequests.push(req)
  })
}

child.on('message', (msg) => {
  const res = msg as Response
  if (!res || typeof res !== 'object' || typeof res.reqId !== 'number') {
    console.error('warning: received invalid response (1)', res)
    return
  }

  let reqIndex = -1
  for (let i = 0; i < currentRequests.length; i++) {
    if (res.reqId === currentRequests[i].reqId) {
      reqIndex = i
    }
  }

  if (reqIndex === -1) {
    console.error('warning: received invalid response (2)', res)
    return
  }

  const req = currentRequests[reqIndex]
  currentRequests.splice(reqIndex, 1)

  if (res.error instanceof Error) {
    req.onRes.reject(res.error)
    return
  }

  req.onRes.resolve(res.result)

  if (LOG_FUNC_TIME) {
    const dt = Number(process.hrtime.bigint() - req.time)
    console.log(`${req.func} took ${(dt / 1000000).toFixed(2)} ms`)
  }
})

const init = (config: Stst.PeerConfig): Promise<void> => {
  return addReq('init', [config])
}

const executeTransaction = (transaction: Stst.TransactionOperation[]): Promise<Stst.TransactionOperationResult[] | void> => {
  return addReq('executeTransaction', [transaction])
}

export default {
  init,
  executeTransaction,
  TransactionOperationAction // re-export enum so it can be used externally
}
