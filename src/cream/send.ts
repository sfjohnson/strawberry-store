import { send } from './udp'
import { encodeVarintU32 } from '../common/utils'
import { MAX_CHUNK_LENGTH } from './constants'
import { Side, PacketType } from './enums'

// NOTE: the following things are necessary, but to save a few cycles they are not checked:
// - dest buffer must be large enough
// - either chunkOffset or totalDataLength must be zero, not both, not neither
// returns: number of bytes written to dest
const writeHeader = (dest: Buffer, packetType: PacketType, chunkOffset: number, totalDataLength: number, reqDataOk: boolean, resDataOk: boolean, reqId: number): number => {
  let flags: number = packetType
  if (reqDataOk) flags |= 0x08
  if (resDataOk) flags |= 0x10
  dest.writeUint32LE(reqId, 1)

  let varintLen
  if (chunkOffset === 0) {
    flags |= 0x04
    varintLen = encodeVarintU32(dest, totalDataLength, 5)
  } else {
    varintLen = encodeVarintU32(dest, chunkOffset, 5)
  }

  dest[0] = flags
  return 5 + varintLen
}

// packet 5. from the spec
export const sendGetChunkIR = (transfer: Transfer, chunkOffset: number, length: number) => {
  // 5 bytes max for uint32 encoded to varint
  const packetBuf = Buffer.alloc(5 + 10)
  const headerLen = writeHeader(packetBuf, PacketType.I_TO_R_GET, chunkOffset, chunkOffset, true, false, transfer.reqId)
  const varintLen = encodeVarintU32(packetBuf, length, headerLen)
  send(transfer.peerId, packetBuf, headerLen + varintLen)
}

// packet 3. from the spec
export const sendGetChunkRI = (transfer: Transfer, chunkOffset: number, length: number) => {
  // 5 bytes max for uint32 encoded to varint
  const packetBuf = Buffer.alloc(5 + 10)
  const headerLen = writeHeader(packetBuf, PacketType.R_TO_I_GET, chunkOffset, chunkOffset, false, false, transfer.reqId)
  const varintLen = encodeVarintU32(packetBuf, length, headerLen)
  send(transfer.peerId, packetBuf, headerLen + varintLen)
}

// packets 1. and 4. from the spec
export const sendChunkDataIR = (transfer: Transfer, chunkOffset: number, length: number = 0) => { // initiator -> responder
  if (transfer.reqData === null) throw new Error('internal state failure (3)') // should never happen

  let chunkLen
  if (chunkOffset === 0) {
    chunkLen = Math.min(transfer.reqData.length, MAX_CHUNK_LENGTH)
  } else {
    // if a specific length has been requested, it is allowed to be larger than MAX_CHUNK_LENGTH
    chunkLen = Math.min(length, transfer.reqData.length)
  }

  // 5 bytes max for uint32 encoded to varint
  const packetBuf = Buffer.alloc(5 + 5 + chunkLen)
  const headerLen = writeHeader(packetBuf, PacketType.I_TO_R_SEND, chunkOffset, transfer.reqData.length, false, false, transfer.reqId)
  transfer.reqData.copy(packetBuf, headerLen, chunkOffset, chunkOffset + chunkLen)
  send(transfer.peerId, packetBuf, headerLen + chunkLen)
}

// packets 2. and 6. from the spec
export const sendChunkDataRI = (transfer: Transfer, chunkOffset: number, length: number = 0) => { // responder -> initiator
  if (transfer.resData === null) throw new Error('internal state failure (4)') // should never happen

  let chunkLen
  if (chunkOffset === 0) {
    chunkLen = Math.min(transfer.resData.length, MAX_CHUNK_LENGTH)
  } else {
    // if a specific length has been requested, it is allowed to be larger than MAX_CHUNK_LENGTH
    chunkLen = Math.min(length, transfer.resData.length)
  }

  // 5 bytes max for uint32 encoded to varint
  const packetBuf = Buffer.alloc(5 + 5 + chunkLen)
  const headerLen = writeHeader(packetBuf, PacketType.R_TO_I_SEND, chunkOffset, transfer.resData.length, true, false, transfer.reqId)
  transfer.resData.copy(packetBuf, headerLen, chunkOffset, chunkOffset + chunkLen)
  send(transfer.peerId, packetBuf, headerLen + chunkLen)
}

// NOTE: this one has no state checks on the transfer object but the above two do
// packet 7. from the spec
export const sendCompletionAckIR = (transfer: Transfer) => {
  const packetBuf = Buffer.alloc(5)
  packetBuf[0] = 0x1f
  packetBuf.writeUint32LE(transfer.reqId, 1)
  send(transfer.peerId, packetBuf)
}
