import { StateChangeEnum, Side, PacketType } from './enums'
import { decodeVarintU32 } from '../common/utils'

const handleChunkDataIR0 = (transfer: Transfer, packetBuf: Buffer): StateChange => { // 1.
  if (transfer.reqData !== null || transfer.reqDataPos !== 0) return { change: StateChangeEnum.ERROR }
  if (transfer.reqDataOk || transfer.resDataOk) return { change: StateChangeEnum.ERROR }
  const { result: totalReqDataLen, newOffset: packetPos } = decodeVarintU32(packetBuf, 5)
  if (totalReqDataLen === 0) return { change: StateChangeEnum.ERROR }

  const chunkLen = packetBuf.length - packetPos
  if (chunkLen <= 0) return { change: StateChangeEnum.ERROR }

  transfer.reqData = Buffer.alloc(totalReqDataLen)
  packetBuf.copy(transfer.reqData, 0, packetPos, packetBuf.length)
  transfer.reqDataPos = chunkLen

  if (totalReqDataLen === chunkLen) return { change: StateChangeEnum.REQ_DATA_OK_TRUE }
  return { change: StateChangeEnum.REQ_CHUNK_FILLED }
}

const handleChunkDataIR = (transfer: Transfer, packetBuf: Buffer): StateChange => { // 4.
  if (transfer.reqData === null || transfer.reqDataOk || transfer.resDataOk) return { change: StateChangeEnum.ERROR }
  const { result: chunkOffset, newOffset: packetPos } = decodeVarintU32(packetBuf, 5)
  if (chunkOffset === 0 || chunkOffset !== transfer.reqDataPos) return { change: StateChangeEnum.ERROR }

  const chunkLen = packetBuf.length - packetPos
  if (chunkLen <= 0 || chunkOffset + chunkLen > transfer.reqData.length) return { change: StateChangeEnum.ERROR }

  packetBuf.copy(transfer.reqData, chunkOffset, packetPos, packetBuf.length)
  transfer.reqDataPos += chunkLen

  if (transfer.reqDataPos === transfer.reqData.length) return { change: StateChangeEnum.REQ_DATA_OK_TRUE }
  return { change: StateChangeEnum.REQ_CHUNK_FILLED }
}

const handleChunkDataRI0 = (transfer: Transfer, packetBuf: Buffer): StateChange => { // 2.
  // resend completion if we happen to get a duplicate type 2. packet from responder
  if (transfer.reqDataOk && transfer.resDataOk) return { change: StateChangeEnum.RES_DATA_OK_TRUE }

  if (transfer.resData !== null || transfer.resDataPos !== 0) return { change: StateChangeEnum.ERROR }
  if (transfer.reqDataOk || transfer.resDataOk) return { change: StateChangeEnum.ERROR }
  const { result: totalResDataLen, newOffset: packetPos } = decodeVarintU32(packetBuf, 5)
  if (totalResDataLen === 0) return { change: StateChangeEnum.ERROR }

  const chunkLen = packetBuf.length - packetPos
  if (chunkLen <= 0) return { change: StateChangeEnum.ERROR }
  transfer.reqDataOk = true // DEBUG: this line should be moved out of this file but I can't think of a nice way to structure it

  transfer.resData = Buffer.alloc(totalResDataLen)
  packetBuf.copy(transfer.resData, 0, packetPos, packetBuf.length)
  transfer.resDataPos = chunkLen

  if (totalResDataLen === chunkLen) return { change: StateChangeEnum.RES_DATA_OK_TRUE }
  return { change: StateChangeEnum.RES_CHUNK_FILLED }
}

const handleChunkDataRI = (transfer: Transfer, packetBuf: Buffer): StateChange => { // 6.
  // resend completion if we happen to get a duplicate type 6. packet from responder
  if (transfer.reqDataOk && transfer.resDataOk) return { change: StateChangeEnum.RES_DATA_OK_TRUE }

  if (transfer.resData === null || !transfer.reqDataOk || transfer.resDataOk) return { change: StateChangeEnum.ERROR }
  const { result: chunkOffset, newOffset: packetPos } = decodeVarintU32(packetBuf, 5)
  if (chunkOffset === 0 || chunkOffset !== transfer.resDataPos) return { change: StateChangeEnum.ERROR }

  const chunkLen = packetBuf.length - packetPos
  if (chunkLen <= 0 || chunkOffset + chunkLen > transfer.resData.length) return { change: StateChangeEnum.ERROR }

  packetBuf.copy(transfer.resData, chunkOffset, packetPos, packetBuf.length)
  transfer.resDataPos += chunkLen

  if (transfer.resDataPos === transfer.resData.length) return { change: StateChangeEnum.RES_DATA_OK_TRUE }
  return { change: StateChangeEnum.RES_CHUNK_FILLED }
}

const handleGetChunkRI = (transfer: Transfer, packetBuf: Buffer, chunkOffsetIs0: boolean): StateChange => { // 3.
  if (transfer.reqData === null || transfer.reqDataOk || transfer.resDataOk) return { change: StateChangeEnum.ERROR }
  const { result: chunkOffset, newOffset: packetPos } = decodeVarintU32(packetBuf, 5)
  if (chunkOffset === 0 && !chunkOffsetIs0) return { change: StateChangeEnum.ERROR }
  const { result: chunkLen, newOffset: packetPos2 } = decodeVarintU32(packetBuf, packetPos)
  if (chunkLen === 0 || packetPos2 !== packetBuf.length) return { change: StateChangeEnum.ERROR }

  return {
    change: StateChangeEnum.SEND_PENDING_IR,
    data: { chunkOffset, chunkLen }
  }
}

const handleGetChunkIR = (transfer: Transfer, packetBuf: Buffer, chunkOffsetIs0: boolean): StateChange => { // 5.
  if (transfer.reqData === null || !transfer.reqDataOk || transfer.resDataOk) return { change: StateChangeEnum.ERROR }
  const { result: chunkOffset, newOffset: packetPos } = decodeVarintU32(packetBuf, 5)
  if (chunkOffset === 0 && !chunkOffsetIs0) return { change: StateChangeEnum.ERROR }
  const { result: chunkLen, newOffset: packetPos2 } = decodeVarintU32(packetBuf, packetPos)
  if (chunkLen === 0 || packetPos2 !== packetBuf.length) return { change: StateChangeEnum.ERROR }

  return {
    change: StateChangeEnum.SEND_PENDING_RI,
    data: { chunkOffset, chunkLen }
  }
}

const handleCompletionAck = (): StateChange => {
  return { change: StateChangeEnum.COMPLETION }
}

export const validateChunkDataIR0 = (packetBuf: Buffer): number | null => {
  // use this on a received packet to figure out if we should create a new responder transfer object
  try {
    if (packetBuf.length < 7) return null
    if ((packetBuf[0] & 0x1f) !== 0x04) return null

    const reqId = packetBuf.readUint32LE(1)
    const { result: totalReqDataLen, newOffset: chunkPos } = decodeVarintU32(packetBuf, 5)
    if (totalReqDataLen === 0) return null

    if (packetBuf.length - chunkPos <= 0) return null
    return reqId
  } catch {
    return null
  }
}

export const readPacketAndUpdateState = (transfer: Transfer, packetBuf: Buffer): StateChange => {
  if (packetBuf.length < 5) return { change: StateChangeEnum.ERROR }

  const flags = packetBuf[0] & 0x1f // zero out unused bits
  const reqId = packetBuf.readUint32LE(1)
  if (reqId !== transfer.reqId) return { change: StateChangeEnum.ERROR }

  const packetType: PacketType = flags & 0x03
  const chunkOffsetIs0: boolean = !!(flags & 0x04)

  if (packetType === PacketType.I_TO_R_SEND && transfer.side !== Side.RESPONDER) return { change: StateChangeEnum.ERROR }
  if (packetType === PacketType.R_TO_I_GET && transfer.side !== Side.INITIATOR) return { change: StateChangeEnum.ERROR }
  if (packetType === PacketType.R_TO_I_SEND && transfer.side !== Side.INITIATOR) return { change: StateChangeEnum.ERROR }
  if (packetType === PacketType.I_TO_R_GET && transfer.side !== Side.RESPONDER) return { change: StateChangeEnum.ERROR }

  try {
    switch (flags) {
      case 0x04: // packet 1. from the spec
        return handleChunkDataIR0(transfer, packetBuf)

      case 0x0e: // 2.
        return handleChunkDataRI0(transfer, packetBuf)

      case 0x01:  // 3. (chunkOffset > 0)
      case 0x05:  // 3. (chunkOffset === 0)
        return handleGetChunkRI(transfer, packetBuf, chunkOffsetIs0)

      case 0x00: // 4.
        return handleChunkDataIR(transfer, packetBuf)

      case 0x0b: // 5. (chunkOffset > 0)
      case 0x0f: // 5. (chunkOffset === 0)
        return handleGetChunkIR(transfer, packetBuf, chunkOffsetIs0)

      case 0x0a: // 6.
        return handleChunkDataRI(transfer, packetBuf)

      case 0x1b: // 7.
      case 0x1f: // 7.
        return handleCompletionAck()

      default:
        return { change: StateChangeEnum.ERROR }
    }
  } catch { // varint decoding error
    return { change: StateChangeEnum.ERROR }
  }
}
