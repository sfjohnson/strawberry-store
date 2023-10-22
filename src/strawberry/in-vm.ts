declare const Sandbox: any
declare const code: string
declare const key: string
declare const currentValue: Buffer | null
declare let newValue: any

const allowedGlobals = {
  Function,
  console: {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    table: console.table,
    warn: console.warn
  },
  parseFloat,
  parseInt,
  decodeURI,
  decodeURIComponent,
  encodeURI,
  encodeURIComponent,
  Boolean,
  Number,
  BigInt,
  String,
  Object,
  Array,
  Symbol,
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Promise,
  JSON,
  Math,
  Buffer: {
    alloc: Buffer.alloc,
    byteLength: Buffer.byteLength,
    compare: Buffer.compare,
    concat: Buffer.concat,
    copyBytesFrom: Buffer.copyBytesFrom,
    from: Buffer.from,
    isBuffer: Buffer.isBuffer,
    isEncoding: Buffer.isEncoding
  }
}

const protos = [
  Boolean,
  Number,
  BigInt,
  String,
  Error,
  Array,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Promise,
  Symbol,
  RegExp
]

const allowedPrototypes = new Map()
protos.forEach((proto) => {
  allowedPrototypes.set(proto, new Set())
})

allowedPrototypes.set(
  Object,
  new Set([
    'entries',
    'fromEntries',
    'getOwnPropertyNames',
    'is',
    'keys',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toString',
    'valueOf',
    'values',
  ])
)

allowedPrototypes.set(
  Buffer,
  new Set([
    'compare',
    'copy',
    'entries',
    'equals',
    'fill',
    'includes',
    'indexOf',
    'keys',
    'lastIndexOf',
    'length',
    'readBigInt64BE',
    'readBigInt64LE',
    'readBigUInt64BE',
    'readBigUInt64LE',
    'readDoubleBE',
    'readDoubleLE',
    'readFloatBE',
    'readFloatLE',
    'readInt8',
    'readInt16BE',
    'readInt16LE',
    'readInt32BE',
    'readInt32LE',
    'readIntBE',
    'readIntLE',
    'readUInt8',
    'readUInt16BE',
    'readUInt16LE',
    'readUInt32BE',
    'readUInt32LE',
    'readUIntBE',
    'readUIntLE',
    'subarray',
    'swap16',
    'swap32',
    'swap64',
    'toJSON',
    'toString',
    'values',
    'write',
    'writeBigInt64BE',
    'writeBigInt64LE',
    'writeBigUInt64BE',
    'writeBigUInt64LE',
    'writeDoubleBE',
    'writeDoubleLE',
    'writeFloatBE',
    'writeFloatLE',
    'writeInt8',
    'writeInt16BE',
    'writeInt16LE',
    'writeInt32BE',
    'writeInt32LE',
    'writeIntBE',
    'writeIntLE',
    'writeUInt8',
    'writeUInt16BE',
    'writeUInt16LE',
    'writeUInt32BE',
    'writeUInt32LE',
    'writeUIntBE',
    'writeUIntLE'
  ])
)

try {
  const sandbox = new Sandbox({
    globals: allowedGlobals,
    prototypeWhitelist: allowedPrototypes
  })

  newValue = sandbox.compile(code)({ key, currentValue }).run()
} catch (err) {
  // Ignore the error if this file has been loaded outside of the vm context
  let outsideVM = err instanceof ReferenceError && err.message === 'Sandbox is not defined'
  if (!outsideVM) throw err
}
