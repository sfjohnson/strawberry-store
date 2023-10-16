interface Peer {
  addr: string // ip address or hostname
  id: string // public key
}

type RequestCallback = (peerId: string, msg: Buffer) => Promise<Buffer>

interface Transfer {
  reqId: number // uint32
  peerId: string // public key
  side: Side
  resendInterval: NodeJS.Timeout | null
  reqData: Buffer | null
  resData: Buffer | null
  resDataPos: number // resDataPos < 0 means transfer is a responder
  reqDataPos: number // reqDataPos < 0 means transfer is an initiator
  reqDataOk: boolean
  resDataOk: boolean
  markedForDeletion: boolean
  lastUpdated: number
  onRes: {
    resolve: (resData: Buffer) => void
    reject: (reason?: any) => void
  } | null
}

type SendPendingData = { chunkOffset: number, chunkLen: number }

interface StateChange {
  change: StateChangeEnum
  data?: SendPendingData
}
