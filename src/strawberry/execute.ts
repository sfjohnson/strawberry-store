import { promises as fsp } from 'fs'
import { URL } from 'url'
import path from 'path'
import vm from 'vm'
import Sandbox from '@nyariv/sandboxjs'

let vmCode: string
let _executeTimeout: number
let initDone = false

export const initExecute = async (executeTimeout: number) => {
  let vmCodePath: any
  if (typeof require !== 'undefined') { // cjs
    vmCodePath = path.join(__dirname, 'in-vm.cjs')
  } else { // es
    vmCodePath = new URL(import.meta.resolve('./in-vm'))
  }  

  vmCode = await fsp.readFile(vmCodePath, { encoding: 'utf-8' })
  _executeTimeout = executeTimeout
  initDone = true
}

export const executeOnKey = (key: string, currentValue: Buffer | null, code: string): Buffer => {
  if (!initDone) throw new Error('Must call initExecute() first!')

  // DEBUG: whyy (Sandbox as any).default ??
  const context = { Buffer, Sandbox: (Sandbox as any).default, code, key, currentValue, newValue: null }

  vm.runInNewContext(vmCode, context, {
    timeout: _executeTimeout,
    contextCodeGeneration: {
      strings: false,
      wasm: false
    }
  })

  if (!Buffer.isBuffer(context.newValue)) throw new Error('Execute failed to return buffer')
  return context.newValue
}
