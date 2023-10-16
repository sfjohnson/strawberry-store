import Stst from '../types'
import v8 from 'v8'

// Returns the parsed message or throws
export const parseMessage = (message: Buffer): Stst.ProtocolMessage => {
  const parsedMessage = v8.deserialize(message) as Stst.ProtocolMessage

  if (typeof parsedMessage.type !== 'number') throw new Error('type must be a number')
  if (typeof parsedMessage.payload !== 'object') throw new Error('payload must be an object')

  return parsedMessage
}

export const serialiseMessage = (message: Stst.ProtocolMessage): Buffer => {
  return v8.serialize(message)
}
