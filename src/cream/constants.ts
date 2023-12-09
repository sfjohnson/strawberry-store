// TODO: make these user configurable
export const UDP_BIND_PORT = 27918
export const MAX_CHUNK_LENGTH = 512 // RFC 791 page 25: Every internet destination must be able to receive a datagram of 576 octets either in one piece or in fragments to be reassembled.
export const RESEND_INTERVAL = 300 // ms
export const CLEANUP_INTERVAL = 2000 // ms
export const TRANSFER_TIMEOUT = 5000 // ms, if there hasn't been any (valid) activity for at least this long, delete the transfer
export const ONREQ_ASYNC_TIMEOUT = 3000 // ms, for responder, fail the transfer if the onReq callback takes longer than this to resolve. must be < TRANSFER_TIMEOUT
