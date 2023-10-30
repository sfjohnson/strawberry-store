import { generateReqId } from '../common/utils'
import { udpInit } from './udp'
import { StateChangeEnum, Side, ResCbStatus } from './enums'
import { readPacketAndUpdateState, validateChunkDataIR0 } from './read'
import { sendChunkDataIR, sendChunkDataRI, sendGetChunkIR, sendGetChunkRI, sendCompletionAckIR } from './send'
import { TRANSFER_TIMEOUT, CLEANUP_INTERVAL, RESEND_INTERVAL, MAX_CHUNK_LENGTH, ONREQ_ASYNC_TIMEOUT } from './constants'

// state
const _transfers: Transfer[] = []
let _onReq: RequestCallback | null = null
let _otherPeerIds: string[] | null = null

const onCleanup = (): void => {
  // iterate backwards as we may delete transfer(s)
  const t = Date.now()

  for (let i = _transfers.length - 1; i >= 0; i--) {
    const transfer = _transfers[i]

    // transfer.onRes.reject does not get called if:
    // - we have already called transfer.onRes.resolve
    // - we are a responder (transfer.onRes is null)
    if (t - transfer.lastUpdated >= TRANSFER_TIMEOUT) {
      if (transfer.resendInterval !== null) clearInterval(transfer.resendInterval)
      _transfers.splice(i, 1)
      // if anyone still holds a ref to this transfer after it is deleted from _transfers,
      // this is the way of telling them to not call sendAndSetResend
      transfer.markedForDeletion = true
      if (transfer.onRes !== null) transfer.onRes.reject(new Error('timeout'))
    } else if (transfer.markedForDeletion) {
      if (transfer.resendInterval !== null) clearInterval(transfer.resendInterval)
      _transfers.splice(i, 1)
      if (transfer.onRes !== null) transfer.onRes.reject(new Error('transfer error'))
    }
  }
}

const sendAndSetResend = (transfer: Transfer, cb: any) => {
  refreshTransfer(transfer, false)
  cb(transfer)
  transfer.resendInterval = setInterval((transfer) => {
    if (transfer.markedForDeletion) {
      refreshTransfer(transfer, false)
      return
    }
    cb(transfer)
  }, RESEND_INTERVAL, transfer)
}

const refreshTransfer = (transfer: Transfer, updateLastUpdated: boolean = true) => {
  if (transfer.resendInterval !== null) {
    clearInterval(transfer.resendInterval)
    transfer.resendInterval = null
  }
  if (updateLastUpdated) transfer.lastUpdated = Date.now()
}

const actOnStateChange = async (transfer: Transfer, change: StateChange): Promise<void> => {
  switch (change.change) {
    case StateChangeEnum.ERROR:
      // don't update lastUpdated; this transfer will eventually get deleted if there are no valid packets
      break

    case StateChangeEnum.REQ_CHUNK_FILLED: // we are responder
      refreshTransfer(transfer)
      sendAndSetResend(transfer, (transfer: Transfer) => {
        if (transfer.reqData === null) return // should not be here
        const chunkLen = Math.min(transfer.reqData.length - transfer.reqDataPos, MAX_CHUNK_LENGTH)
        sendGetChunkRI(transfer, transfer.reqDataPos, chunkLen)
      })
      break

    case StateChangeEnum.RES_CHUNK_FILLED: // we are initiator
    refreshTransfer(transfer)
      sendAndSetResend(transfer, (transfer: Transfer) => {
        if (transfer.resData === null) return // should not be here
        const chunkLen = Math.min(transfer.resData.length - transfer.resDataPos, MAX_CHUNK_LENGTH)
        sendGetChunkIR(transfer, transfer.resDataPos, chunkLen)
      })
      break

    case StateChangeEnum.REQ_DATA_OK_TRUE: // we are responder
      if (transfer.reqData === null || _onReq === null) break // should not be here
      refreshTransfer(transfer)
      transfer.resData = await Promise.race<Buffer>([
        _onReq(transfer.peerId, transfer.reqData),
        new Promise((_, reject) => {
          setTimeout(reject, ONREQ_ASYNC_TIMEOUT, new Error('onReq async timeout'))
        })
      ])
      // if constants were set incorrectly it is possible for transfer to be deleted from _transfers here
      if (transfer.markedForDeletion) break
      transfer.reqDataOk = true
      sendAndSetResend(transfer, (transfer: Transfer) => sendChunkDataRI(transfer, 0))
      break

    case StateChangeEnum.RES_DATA_OK_TRUE: // we are initiator
      // we are done but don't delete transfer immediately as we might need to re-send completion ack
      // don't update lastUpdated; let the transfer be deleted after a time
      refreshTransfer(transfer, false)
      if (transfer.resDataOk) {
        sendCompletionAckIR(transfer)
      } else {
        transfer.resDataOk = true
        if (transfer.resData !== null && transfer.onRes !== null) {
          transfer.onRes.resolve(transfer.resData) // should never be null
        }
        sendCompletionAckIR(transfer)
      }
      break

    case StateChangeEnum.SEND_PENDING_IR: // we are initiator
      if (!change.data) break // should not be here
      refreshTransfer(transfer)
      sendChunkDataIR(transfer, change.data.chunkOffset, change.data.chunkLen)
      break

    case StateChangeEnum.SEND_PENDING_RI: // we are responder
      if (!change.data) break // should not be here
      refreshTransfer(transfer)
      // we might need to resend chunkDataRI to receive another completionAckIR if it was dropped
      sendAndSetResend(transfer,
        sendChunkDataRI.bind(null, transfer, change.data.chunkOffset, change.data.chunkLen)
      )
      break

    case StateChangeEnum.COMPLETION: // we are responder
      // transfer can be deleted immediately, no need to wait for stray packets
      refreshTransfer(transfer, false)
      transfer.markedForDeletion = true
      break
  }
}

const tryCreateNewResponderTransfer = (peerId: string, reqId: number) => {
  for (const transfer of _transfers) if (transfer.reqId === reqId) return

  _transfers.push({
    reqId,
    peerId,
    side: Side.RESPONDER,
    resendInterval: null,
    reqData: null,
    resData: null,
    resDataPos: 0,
    reqDataPos: 0,
    reqDataOk: false,
    resDataOk: false,
    markedForDeletion: false,
    lastUpdated: Date.now(),
    onRes: null
  })
}

const onMsg = (peer: Peer, msg: Buffer): void => {
  const reqId: number | null = validateChunkDataIR0(msg)
  if (reqId !== null) tryCreateNewResponderTransfer(peer.id, reqId)

  for (const transfer of _transfers) {
    // discard the promise that is returned
    (async (_transfer: Transfer, _peer: Peer, _msg: Buffer): Promise<void> => {
      // NOTE: the same remote peer could have multiple transfers in-flight
      if (_transfer.peerId !== _peer.id || _transfer.markedForDeletion) return
      try {
        await actOnStateChange(_transfer, readPacketAndUpdateState(_transfer, _msg))
      } catch (err) {
        // oopsies, something unrecoverable happened
        refreshTransfer(_transfer, false)
        _transfer.markedForDeletion = true
        console.error(err) // DEBUG: log
      }
    })(transfer, peer, msg)
  }
}

// this is for both sides, onReq should be null for initiator
export const reqResInit = (otherPeers: Peer[], onReq: RequestCallback | null): Promise<void> => {
  _onReq = onReq
  _otherPeerIds = otherPeers.map(({ id }) => id)
  setInterval(onCleanup, CLEANUP_INTERVAL)  

  return udpInit(otherPeers, onMsg)
}

// this is for the initiator side
export const initiateReq = async (peerId: string, reqData: Buffer): Promise<Buffer> => {
  const reqId = await generateReqId()

  return new Promise((resolve, reject) => {
    const transfer: Transfer = {
      reqId,
      peerId,
      side: Side.INITIATOR,
      resendInterval: null,
      reqData,
      resData: null,
      resDataPos: 0,
      reqDataPos: 0,
      reqDataOk: false,
      resDataOk: false,
      markedForDeletion: false, // setting this to true causes onRes.reject to be called
      lastUpdated: Date.now(),
      onRes: { resolve, reject }
    }

    _transfers.push(transfer)
    sendAndSetResend(transfer, (transfer: Transfer) => sendChunkDataIR(transfer, 0))
  })
}

// this is for the initiator side
export const initiateReqAll = async (reqData: Buffer): Promise<(Buffer | null)[]> => {
  if (_otherPeerIds === null) throw new Error('reqResInit not called')

  const responses = await Promise.allSettled(_otherPeerIds.map((peerId) => {
    return initiateReq(peerId, reqData)
  }))

  // DEBUG: we are discarding the error messages, are they useful?
  return responses.map((res) => res.status === 'fulfilled' ? res.value : null)
}

// this is for the initiator side
// this function:
// 1. initiates a request with each of the other peer IDs
// 2. calls onResCb for each response
// 3. rejects, resolves or continues based on what onResCb returns
// 4. rejects if all reqs have settled but onResCb has only returned ResCbStatus.CONTINUE
// 5. if onResCb returns ResCbStatus.RESOLVE, resolves with an array of responses
export const initiateReqEach = async (reqData: Buffer, onResCb: (res: Buffer) => ResCbStatus): Promise<Buffer[]> => {
  return new Promise ((resolve, reject) => {
    if (_otherPeerIds === null) {
      reject(new Error('reqResInit not called'))
      return
    }

    const settledCountTarget = _otherPeerIds!.length
    let settledCount = 0
    let responses: Buffer[] = []

    for (const peerId of _otherPeerIds) {
      initiateReq(peerId, reqData).then((res) => {
        if (settledCount === settledCountTarget) return

        switch(onResCb(res)) {
          case ResCbStatus.CONTINUE:
            if (++settledCount === settledCountTarget) {
              reject(new Error('cannot continue, all requests settled'))
              break
            }
            responses.push(res)
            break
          case ResCbStatus.RESOLVE:
            responses.push(res)
            settledCount = settledCountTarget
            resolve(responses)
            break
          case ResCbStatus.REJECT:
            settledCount = settledCountTarget
            reject(new Error('resCb rejected'))
            break
        }
      }).catch(() => {
        if (settledCount === settledCountTarget) return

        if (++settledCount === settledCountTarget) {
          reject(new Error('not enough responses received'))
        }
      })
    }
  })
}
