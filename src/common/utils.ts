import crypto from 'crypto'

export const asyncDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// NOTE: there is no bounds checking, subEpoch must be between 0 to 999 inclusive and the result must not overflow a double significand
export const timestampToNumber = ({ epoch, subEpoch }: { epoch: number, subEpoch: number }): number => 1000 * epoch + subEpoch

export const numberToTimestamp = (n: number): { epoch: number, subEpoch: number } => {
  return { epoch: Math.floor(n / 1000), subEpoch: n % 1000 }
}

// Generate an integer from 0 to 999 inclusive
export const generateSubEpoch = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(2, (err, buf) => {
      if (err) {
        reject(err)
      } else {
        resolve((buf[0] | (buf[1] << 8)) % 1000)
      }
    })
  })
}

// Generate an unsigned 32-bit integer
export const generateReqId = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(4, (err, buf) => {
      if (err) {
        reject(err)
      } else {
        resolve(buf.readUInt32LE())
      }
    })
  })
}

// returns number of bytes written to dest at offset
export const encodeVarintU32 = (dest: Buffer, val: number, offset: number = 0): number => {
  if (val >= 4294967296) throw new Error('val overflows U32')

  let pos = offset

  do {
    if (pos >= dest.length) throw new Error('dest too small')
    dest[pos] = (val & 0x7f) | 0x80
    val >>>= 7
    pos++
  } while (val > 0)

  dest[pos-1] &= 0x7f
  return pos - offset
}

export const decodeVarintU32 = (src: Buffer, offset: number) => {
  let bytePos = offset
  let bitPos = 0
  let result = 0

  do {
    if (bitPos >= 32) throw new Error('result overflows U32')
    if (bytePos >= src.length) throw new Error('src too small')
    result += ((src[bytePos] & 0x7f) << bitPos) >>> 0 // >>> 0 is a silly JS thing to stop it from going negative, you also can't do |=
    bitPos += 7
    bytePos++
  } while (src[bytePos-1] & 0x80)

  return { result, newOffset: bytePos }
}
