import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const esbuild = join(root, 'frontend', 'node_modules', '.bin', 'esbuild')
mkdirSync(join(here, 'dist'), { recursive: true })
const common = ['src/index.ts', '--bundle', '--platform=browser', '--target=chrome120']
execFileSync(esbuild, [...common, '--format=iife', '--global-name=KeWorkshopSDK', '--outfile=dist/guest-sdk.js'], { cwd: here, stdio: 'inherit' })
execFileSync(esbuild, [...common, '--format=esm', '--outfile=dist/guest-sdk.mjs'], { cwd: here, stdio: 'inherit' })
console.log('built dist/guest-sdk.js + dist/guest-sdk.mjs')
