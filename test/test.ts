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
const GARBAGE_COLLECTOR_INTERVAL = 30000 // ms

// NOTE (for crawlers): These ed25519 keys have been generated for this test only and have not been re-used anywhere else.
// 3 * MAX_FAULTY_PEERS + 1 is the minimum required number of peers
const PEERS = [
  {
    pubKey: 'P5b6USge7l7eUz09avXs+UiH8D/OqNIAtpHgv9REwjk=',
    privKey: 'fd/an4Gy4gkuNFOVfzHIrOck9hp5Ob+MnMp0bMJ533o=',
    addr: '172.24.0.2'
  },
  {
    pubKey: 'xIhMpfOOQJjDeYk99L55eONHAWMotHHLQIfyyk3cGLY=',
    privKey: 'UAtWwxNaX9qQBtsQKna9dvdT0cz7gFRLs9opN+Nl6cc=',
    addr: '172.24.0.3'
  },
  {
    pubKey: 'Wkvy8EhGy9oM/47GuBNcHvCdw2A59Rg4Hp0lteQ5OLs=',
    privKey: '+2aIuqRlO94eHsc4ffGwZU7ETserCsMSVlF6DozeEkc=',
    addr: '172.24.0.4'
  },
  {
    pubKey: 'iM+wF+sCOG2jw+yxgxWkvdK3FhYOGKxoMva22F6AxKo=',
    privKey: 'EqAksx4w2Ty6yK+LlykhkbQQZwuMoWWiqTsOadaoTjg=',
    addr: '172.24.0.5'
  },
  {
    pubKey: 'CeDIEKygVz3s5OQOA0LsWpXhTik6/XipA/7n7ryw4wo=',
    privKey: 'EGJxC1jg/DXe80HkpwLl13yI4dySx4k7Mkdvp6RLd/U=',
    addr: '172.24.0.6'
  }
]

const getPeerIndexAndIp = () => {
  const ifaces = networkInterfaces()
  for (const iface of Object.keys(ifaces)) {
    if (iface !== 'eth0') continue

    for (const addr of ifaces[iface]!) {
      if (addr.family !== 'IPv4') continue
      return {
        index: parseInt(addr.address.split('.')[3]) - 2,
        ip: addr.address
      }
    }
  }
  throw new Error('getPeerIndexAndIp failed')
}

const startPeer = async (index: number) => {
  // const index = parseInt(indexStr)

  const peerPubKeys: string[] = []
  const peerAddrs: string[] = []
  for (let i = 0; i < PEERS.length; i++) {
    if (i === index) continue
    peerPubKeys.push(PEERS[i].pubKey)
    peerAddrs.push(PEERS[i].addr)
  }

  await init({
    myPubKey: PEERS[index].pubKey,
    myPrivKey: PEERS[index].privKey,
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
    gcInterval: GARBAGE_COLLECTOR_INTERVAL
  })

  // wait for all hosts to init
  await asyncDelay(2000)

  try {
    if (index === 0) {
      await initiatorEntrypoint(PEERS[index].pubKey)
    } else {
      await responderEntrypoint(PEERS[index].pubKey)
    }
  } catch (err: unknown) {
    console.log(`ERROR ${PEERS[index].pubKey}: ${(err as Error).message}`)
  }
}

const { index, ip } = getPeerIndexAndIp()
console.log('my peer index', index, 'ip', ip)
startPeer(index)

// const parent = (index: string) => {
//   // const controller = new AbortController()
//   // const { signal } = controller
//   const child = fork(fileURLToPath(import.meta.url), ['child', index], { /*signal*/ })
//   child.on('error', (err: Error) => {
//     console.log(`child ${index}`, err)
//   })
//   // setTimeout(() => {
//   //   controller.abort() // Stops the child process
//   // }, 5000)
// }

// if (process.argv[2] === 'child') {
//   child(process.argv[3])
// } else {
//   for (let i = 0; i < PEERS.length; i++) parent(i.toString())
// }
