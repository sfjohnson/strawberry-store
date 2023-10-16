import { register } from 'module'
import { pathToFileURL } from 'url'

register('commonjs-extension-resolution-loader', pathToFileURL('./'))
