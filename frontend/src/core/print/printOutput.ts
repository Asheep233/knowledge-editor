/**
 * T26 G3：产品打印输出路径（隔离目录 + 路径安全）。
 *
 * 安全约束（T16 / A2 已验证的 Rust 侧约束，前端先做第一道校验）：
 * - **绝对路径**、`.pdf` 后缀、无 `..` 穿越 / NUL / 非法段（Rust `print_snapshot_pdf` 还会再验）；
 * - **不覆盖**：文件名含 revision + 时间 + 随机后缀（Rust 侧目标已存在会拒绝）；
 * - 输出落在**应用数据目录**（`appDataDir()`，Windows `%APPDATA%\<identifier>`），
 *   **不写工作区/用户笔记目录**；该目录由启动时工坊 recover 状态落盘
 *   （`pack_store::write_recover_status` → create_dir_all）保证存在；
 * - 隔离测试构建中 `APPDATA` 被注入 `C:\ke-tmp\...` → PDF 同样只在隔离目录（W 证据可验证）。
 */
import { appDataDir } from '@tauri-apps/api/path'

export interface PrintTargetRequest {
  relPath: string
  revision: number
}

export interface PrintTargetOptions extends PrintTargetRequest {
  /** 输出基准目录（绝对路径；默认 appDataDir()；测试注入） */
  baseDir?: string
  /** 可注入时钟/随机源（测试唯一文件名用） */
  now?: () => number
  random?: () => number
}

const WINDOWS_ABS = /^[A-Za-z]:[\\/]/
const UNC_ABS = /^\\\\[^\\]+\\/

/** 是否为（Windows）绝对路径（`C:\`、`C:/`、`\\server\share`）。 */
export function isAbsolutePath(path: string): boolean {
  return WINDOWS_ABS.test(path) || UNC_ABS.test(path)
}

/** 把 relPath 压成安全的文件名主干（不含目录/危险字符）。 */
export function sanitizePrintFileStem(relPath: string, max = 40): string {
  const base = relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() ?? 'document'
  const stem = base
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/^\.+$/, '')
    .trim()
    .slice(0, max)
  return stem.length > 0 ? stem : 'document'
}

/**
 * 打印目标路径校验（注入 PrintJobManager.validateTargetPath / 单测直接调用）：
 * 不合法立即抛错 → Job 在排队阶段就失败，不进入渲染/打印。
 */
export function assertPrintTargetPath(targetPath: string): void {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw new Error('E_PATH: 打印输出路径为空')
  }
  if (targetPath.includes('\0')) throw new Error('E_PATH: 打印输出路径含非法字符')
  if (!isAbsolutePath(targetPath)) throw new Error(`E_PATH: 打印输出必须是绝对路径: ${targetPath}`)
  const normalized = targetPath.replace(/\\/g, '/')
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new Error(`E_PATH: 打印输出路径不允许包含 ..: ${targetPath}`)
  }
  if (!/\.pdf$/i.test(normalized)) throw new Error(`E_PATH: 打印输出必须是 .pdf: ${targetPath}`)
}

/** 在 baseDir 下构造唯一、不覆盖的打印目标路径（绝对路径）。 */
export function buildPrintTargetPath(options: PrintTargetOptions & { baseDir: string }): string {
  const baseDir = options.baseDir.replace(/[\\/]+$/, '')
  if (!isAbsolutePath(baseDir)) throw new Error(`E_PATH: 打印输出目录必须是绝对路径: ${options.baseDir}`)
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const stamp = now().toString(36)
  const rand = Math.floor(random() * 0x10000)
    .toString(36)
    .padStart(2, '0')
  if (!Number.isInteger(options.revision) || options.revision < 0) {
    throw new Error('E_SNAPSHOT: 非法 revision，拒绝构造打印路径')
  }
  const stem = sanitizePrintFileStem(options.relPath)
  const target = `${baseDir.replace(/\//g, '\\')}\\print-${stem}-r${options.revision}-${stamp}${rand}.pdf`
  assertPrintTargetPath(target)
  return target
}

interface PrintOutputWindow {
  /** 诊断/隔离 W 覆盖打印输出基准目录（仅可信主窗口可设置；生产不设置 → appDataDir()） */
  __KE_PRINT_OUTPUT_DIR__?: unknown
}

/** 读取主窗口诊断覆盖的输出目录（非法值忽略）；无 window（测试/非桌面）→ null。 */
export function printOutputDirOverride(): string | null {
  if (typeof window === 'undefined') return null
  const raw = (window as PrintOutputWindow).__KE_PRINT_OUTPUT_DIR__
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.includes('\0')) return null
  if (!isAbsolutePath(raw)) return null
  return raw
}

/** 产品默认输出基准目录：应用数据目录（非工作区；Windows `%APPDATA%\<identifier>`）。 */
export async function defaultPrintBaseDir(): Promise<string> {
  return await appDataDir()
}

/** 实际输出基准目录：诊断覆盖（隔离 W/排障）优先，否则 appDataDir()。 */
export async function resolvePrintBaseDir(): Promise<string> {
  return printOutputDirOverride() ?? (await defaultPrintBaseDir())
}

/** 解析本次 print.snapshot 的输出目标（默认落在 appDataDir 根下）。 */
export async function resolvePrintTarget(
  request: PrintTargetRequest,
  options: { baseDir?: string; now?: () => number; random?: () => number } = {},
): Promise<string> {
  const baseDir = options.baseDir ?? (await resolvePrintBaseDir())
  return buildPrintTargetPath({ ...request, ...options, baseDir })
}
