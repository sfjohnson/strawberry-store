import { networkInterfaces } from 'os'
import { init } from '../src'
import { asyncDelay } from '../src/common/utils'
import { initiatorEntrypoint } from './initiator'
import { responderEntrypoint } from './responder'

const MAX_FAULTY_PEERS = 1
const READ_TIMEOUT = 1000 // ms
const READ_REQUEST_RETRY_COUNT = 1
const WRITE_1_TIMEOUT = 1000 // ms
const WRITE_1_REQUEST_RETRY_COUNT = 1
const WRITE_2_TIMEOUT = 1000 // ms
const WRITE_2_REQUEST_RETRY_COUNT = 1
const EXECUTE_TIMEOUT = 500 // ms
const GARBAGE_COLLECTOR_INTERVAL = 30000 // ms

// NOTE (for crawlers): These ed25519 keys have been generated for this test only and have not been re-used anywhere else.
// 3 * MAX_FAULTY_PEERS + 1 is the minimum required number of peers
const PEERS = [
  {
    pubKey: 'P5b6USge7l7eUz09avXs+UiH8D/OqNIAtpHgv9REwjk=',
    privKey: 'fd/an4Gy4gkuNFOVfzHIrOck9hp5Ob+MnMp0bMJ533o=',
  },
  {
    pubKey: 'xIhMpfOOQJjDeYk99L55eONHAWMotHHLQIfyyk3cGLY=',
    privKey: 'UAtWwxNaX9qQBtsQKna9dvdT0cz7gFRLs9opN+Nl6cc=',
  },
  {
    pubKey: 'Wkvy8EhGy9oM/47GuBNcHvCdw2A59Rg4Hp0lteQ5OLs=',
    privKey: '+2aIuqRlO94eHsc4ffGwZU7ETserCsMSVlF6DozeEkc=',
  },
  {
    pubKey: 'iM+wF+sCOG2jw+yxgxWkvdK3FhYOGKxoMva22F6AxKo=',
    privKey: 'EqAksx4w2Ty6yK+LlykhkbQQZwuMoWWiqTsOadaoTjg=',
  },
  {
    pubKey: 'CeDIEKygVz3s5OQOA0LsWpXhTik6/XipA/7n7ryw4wo=',
    privKey: 'EGJxC1jg/DXe80HkpwLl13yI4dySx4k7Mkdvp6RLd/U=',
  }
]

const getMyAddr = () => {
  const ifaces = networkInterfaces()
  for (const iface of Object.keys(ifaces)) {
    if (iface !== 'eth0') continue

    for (const addr of ifaces[iface]!) {
      if (addr.family !== 'IPv4') continue
      return addr.address
    }
  }
  throw new Error('getPeerIndexAndIp failed')
}

const startPeer = async (myAddr: string) => {
  const myAddrOctets = myAddr.split('.')
  if (myAddrOctets.length !== 4) throw new Error(`myAddr not valid IPv4: ${myAddr}`)

  const myIndex = parseInt(myAddrOctets[3]) - 2
  console.log('my peer index', myIndex, 'addr', myAddr)

  const peerPubKeys: string[] = []
  const peerAddrs: string[] = []
  for (let i = 0; i < PEERS.length; i++) {
    if (i === myIndex) continue
    peerPubKeys.push(PEERS[i].pubKey)
    peerAddrs.push(`${myAddrOctets[0]}.${myAddrOctets[1]}.${myAddrOctets[2]}.${i + 2}`)
  }

  await init({
    myPubKey: PEERS[myIndex].pubKey,
    myPrivKey: PEERS[myIndex].privKey,
    peerPubKeys,
    peerAddrs,
    appDirName: 'strawberry-store',
    maxFaultyPeers: MAX_FAULTY_PEERS,
    readTimeout: READ_TIMEOUT,
    readRequestRetryCount: READ_REQUEST_RETRY_COUNT,
    write1Timeout: WRITE_1_TIMEOUT,
    write1RequestRetryCount: WRITE_1_REQUEST_RETRY_COUNT,
    write2Timeout: WRITE_2_TIMEOUT,
    write2RequestRetryCount: WRITE_2_REQUEST_RETRY_COUNT,
    executeTimeout: EXECUTE_TIMEOUT,
    gcInterval: GARBAGE_COLLECTOR_INTERVAL
  })

  // wait for all hosts to init
  await asyncDelay(2000)

  try {
    if (myIndex === 0) {
      await initiatorEntrypoint(PEERS[myIndex].pubKey)
    } else {
      await responderEntrypoint(PEERS[myIndex].pubKey)
    }
  } catch (err: unknown) {
    console.log(`ERROR ${PEERS[myIndex].pubKey}: ${(err as Error).message}`)
  }
}

startPeer(getMyAddr())
