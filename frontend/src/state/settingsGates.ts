/**
 * 设置「死开关」接线决策（P2-7）。
 *
 * SettingsPanel 声明了多组设置；经核实：
 *  - autosaveIntervalMs / theme：已接线（EditorArea 防抖、applyTheme）。
 *  - historyRetentionCount：已通过 Tauri get_settings/update_settings 持久化，
 *    由后端快照保留逻辑消费（前端无独立读取点，属于后端治理）。
 *  - restoreLastState / autoOpenRecentWorkspace：此前仅保存在 settings.json / localStorage，
 *    App 启动流程从未消费 → 死开关。本模块把「是否真正执行」抽成纯函数并接线到 App 启动。
 */

export interface StartupGateInput {
  autoOpenRecentWorkspace: boolean
  restoreLastState: boolean
  /** 是否存在可用的最近工作区（exists=true 的记录） */
  hasRecentWorkspace: boolean
  /** 是否记录了上次打开的文档 id */
  hasLastArticle: boolean
}

export interface StartupPlan {
  autoOpenRecentWorkspace: boolean
  restoreLastArticle: boolean
}

/** 根据设置与当前数据，决定启动时是否执行「自动打开最近工作区 / 恢复上次文档」。 */
export function planStartup(g: StartupGateInput): StartupPlan {
  return {
    autoOpenRecentWorkspace: !!g.autoOpenRecentWorkspace && !!g.hasRecentWorkspace,
    restoreLastArticle: !!g.restoreLastState && !!g.hasLastArticle,
  }
}
