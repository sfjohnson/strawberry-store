import BetterSqlite3 from 'better-sqlite3'
import v8 from 'v8'
import os from 'os'
import path from 'path'
import { promises as fsp } from 'fs'

// TODO: use sqlite transactions instead of lockKeys and unlockKeys
// TODO: use protobufs instead of v8.serialize/deserialize

// map key is store key, map value is a promise that gets resolved when the key is unlocked and the callback to resolve it
const currentLocks = new Map<string, { promise: Promise<void>, resolve: Function }>()

let db: BetterSqlite3.Database | null = null

export const initStore = async (appName: string) => {
  let dataDir
  switch (os.platform()) {
    case 'win32':
      dataDir = path.join(os.homedir(), 'AppData/Local', appName)
      break
    
    case 'darwin':
      dataDir = path.join(os.homedir(), 'Library/Application Support', appName)
      break
    
    case 'linux':
      dataDir = path.join(os.homedir(), `.${appName}`)
      break

    default:
      throw new Error('OS not supported')
  }

  await fsp.mkdir(dataDir, { recursive: true })

  db = new BetterSqlite3(path.join(dataDir, 'strawberry-store.db'))
  db.pragma('journal_mode = WAL')
  db.prepare('CREATE TABLE IF NOT EXISTS store(key varchar PRIMARY KEY, value BLOB)').run()
}

// DEBUG: implement auto-unlock after a timeout?
export const lockKeys = async (keys: string[]) => {
  const unlockPromises: Promise<void>[] = []
  for (const key of keys) {
    const lock = currentLocks.get(key)
    if (lock) unlockPromises.push(lock.promise)
  }

  // If any keys were locked, first wait for them all to be unlocked
  await Promise.all(unlockPromises)

  for (const key of keys) {
    currentLocks.delete(key)
    let resolve: Function | undefined
    const promise: Promise<void> = new Promise((_resolve) => {
      resolve = _resolve
    })
    currentLocks.set(key, { promise, resolve: resolve as Function })
  }
}

export const unlockKeys = (keys: string[]) => {
  for (const key of keys) {
    const lock = currentLocks.get(key)
    if (lock) {
      currentLocks.delete(key)
      lock.resolve()
    }
  }
}

export const getKey = (key: string): Stst.StoreValueObjectContainer | undefined => {
  if (db === null) throw new Error('initStore not called')

  const statement = db.prepare('SELECT value FROM store WHERE key = ?')
  const row = statement.pluck().get(key)
  if (!row) return undefined

  return v8.deserialize(row as Buffer)
}

export const setKey = (key: string, svoc: Stst.StoreValueObjectContainer): void => {
  if (db === null) throw new Error('initStore not called')

  const statement = db.prepare('INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
  statement.run(key, v8.serialize(svoc))
}

export const getAllKeysIterator = (): IterableIterator<string> => {
  if (db === null) throw new Error('initStore not called')

  const statement = db.prepare('SELECT key FROM store')
  return statement.pluck().iterate() as IterableIterator<string>
}
