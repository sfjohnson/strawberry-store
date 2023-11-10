import crypto from 'crypto'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m)) // for synchronous methods

const privKey = crypto.randomBytes(32)
const derivedPubKey = ed.getPublicKey(privKey)

console.log('private', Buffer.from(privKey).toString('base64'))
console.log('public ', Buffer.from(derivedPubKey).toString('base64'))
