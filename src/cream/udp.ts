import dgram from 'dgram'
import { UDP_BIND_PORT } from './constants'

export interface PeerWithPort extends Peer {
  udpPort: number
}

// state
let _sock: dgram.Socket | null = null
let _peers: PeerWithPort[] = []
let _bound = false

export const udpInit = (otherPeers: Peer[], onMessage: (peer: Peer, msg: Buffer) => void): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (_bound || _peers.length !== 0) reject(new Error('udp init already done'))

    for (const { addr, id } of otherPeers) {
      // NOTE: On a LAN the remote port will always be UDP_BIND_PORT, but on a WAN the peering strategy is for
      // both sides to fire packets at each other on UDP_BIND_PORT until something gets through, and then
      // use the received remote ports for any future packets. Since a STUN server is not used, two
      // NATs where the port numbers are changed (e.g. cellular, corporate networks) will not be able
      // to peer with each other.
      // If IP addresses are used instead of hostnames, they must be static.
      _peers.push({ udpPort: UDP_BIND_PORT, addr, id })
    }

    _sock = dgram.createSocket('udp4')
    _sock.on('error', reject)

    _sock.on('message', (msg, rinfo) => {
      let msgPeer: PeerWithPort | null = null
      for (const peer of _peers) {
        if (rinfo.address === peer.addr) {
          msgPeer = peer
          break
        }
      }
      if (msgPeer === null) return

      msgPeer.udpPort = rinfo.port
      onMessage(msgPeer, msg)
    })

    _sock.bind(UDP_BIND_PORT, () => {
      console.log(`Bound to UDP port ${UDP_BIND_PORT}`)
      _bound = true
      resolve()
    })
  })
}

export const send = (peerId: string, message: Buffer, length: number = -1): void => {
  if (!_bound || _sock === null) {
    throw new Error('can\'t call send(), init not called')
  }

  let sendPeer: PeerWithPort | null = null
  for (const peer of _peers) {
    if (peer.id === peerId) sendPeer = peer
  }
  if (sendPeer === null) throw new Error('peerId not found')

  if (length < 0) {
    _sock.send(message, sendPeer.udpPort, sendPeer.addr)
  } else {
    _sock.send(message, 0, length, sendPeer.udpPort, sendPeer.addr)
  }
}
