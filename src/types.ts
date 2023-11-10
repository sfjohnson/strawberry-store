// NOTE: all numbers are 53 bit signed int

import { ProtocolMessageType, TransactionOperationAction } from './enums'

declare namespace Stst {
  interface ReadReqMessage {
    // Replay protection is given by reqId in cream layer
    transaction: TransactionOperation[]
  }

  interface ReadResMessage {
    results: ReadOperationResult[]
  }

  interface Write1ReqMessage {
    // Write1Req transaction doesn't need values, only action and key
    transaction: TransactionOperation[]
    subEpoch: number
    transactionHash: string
  }

  interface Write1OkResMessage {
    multiGrant: MultiGrant
  }

  interface Write1RefusedResMessage {
    message: string
  }

  interface Write2ReqMessage {
    writeCertificate: WriteCertificate
    transaction: TransactionOperation[]
  }

  interface Write2OkResMessage {
    transactionHash: string
  }

  interface Write2RefusedResMessage {
    message: string
  }

  type WriteResMessage = Write1OkResMessage | Write1RefusedResMessage | Write2OkResMessage | Write2RefusedResMessage
  type WriteMessage = Write1ReqMessage | Write1OkResMessage | Write1RefusedResMessage | Write2ReqMessage | Write2OkResMessage | Write2RefusedResMessage
  type ReadMessage = ReadReqMessage | ReadResMessage

  interface ProtocolMessage {
    type: ProtocolMessageType
    payload: WriteMessage | ReadMessage
  }

  // Phase 1, server replies with MultiGrant, which is signed and contains grants
  interface MultiGrant {
    grants: Map<string, number> // key is object key, value is timestamp packed using utils.timestampToNumber
    initiatorPubKey: string
    responderPubKey: string
    transactionHash: string
    signature: string // ed25519 signature as 64 byte base64 encoded string
  }

  // Contains MultiGrant per each server which participated in that decision. Grants are signed
  type WriteCertificate = MultiGrant[]

  // This corresponds to 1 object in the database
  interface StoreValueObjectContainer {
    value: Buffer | null
    valueAvailable: boolean
    currentCertificate: WriteCertificate | null
    // We save Write1Grant for every Object to avoid giving new Write1Grant to a different transaction on the very same timestamp and also to respond to Write1ToServer retries
    // Write1Multigrants that were given 2 or more epochs before the currentCertificate's epoch are removed by the GC
    // Outer map key is epoch part of timestamp, inner map key is full timestamp (packed using utils.timestampToNumber),
    // inner map value is the Write1Multigrant given on that timestamp containing this object
    grantHistory: Map<number, Map<number, Stst.MultiGrant>>
  }

  interface PeerConfig {
    myPrivKey: string // ed25519 key as 32 byte base64 encoded string
    peerPubKeys: string[] // The length of this must be at least 3 * maxFaultyPeers
    peerAddrs?: string[] // IP addresses, can be undefined if network discovery is being used
    appDirName?: string // directory where database is stored in app data, only used for sqlite-store
    maxFaultyPeers: number
    readTimeout: number // in ms, this is both the maximum time to wait for a read response and also the amount of time to wait until retrying after non-matching responses
    readRequestRetryCount: number // 0 means send only 1 request and throw an error if it times out, 1 means retry once etc.
    write1Timeout: number // in ms, this timeout is in addition to the timeout in the cream layer
    write1RequestRetryCount: number
    write2Timeout: number // in ms, this timeout is in addition to the timeout in the cream layer
    write2RequestRetryCount: number
    executeTimeout: number // in ms, the maximum amount of time an EXECUTE operation is allowed to run for
    gcInterval: number // how often garbage collection runs, in ms
  }

  interface TransactionOperation {
    action: TransactionOperationAction
    key: string
    value?: Buffer | null
  }

  // For executeTransaction()
  interface TransactionOperationResult {
    key: string
    value?: Buffer | null
  }

  // For read response message
  interface ReadOperationResult {
    key: string
    valueAvailable: boolean
    value: Buffer | null
    currentCertificate: WriteCertificate | null
  }

  // Not actually used, just here to demonstrate the shape of the data
  // interface ObjectStore {
  //   objects: Map<string, StoreValueObjectContainer> // key is object key
  // }
}

export default Stst
