/**
 * UI 工坊 P3-T18：把 Broker 接到协议 HostDispatcher 的绑定层。
 *
 * - `brokeredHandlers(broker, connection)`：返回 HostHandlers，所有方法先经 Broker 授权
 *   （能力/epoch/命令白名单/有界），再把授权结果映射为 host 侧业务调用；
 * - `protocol.capabilities` 不经过后端（握手期即可用），返回连接已授能力与绑定 context/epoch；
 * - Broker 抛出的 ProtocolError 类型化错误原样传播给协议层（由 HostDispatcher 转成响应 error）。
 */
import type { HostHandlers } from '../protocol/channel'
import { PROTOCOL_VERSION, isProtocolError, protocolError, type MethodName, type ProtocolError, type ProtocolMethods } from '../protocol/types'
import { Broker, type BrokerConnection } from './broker'

/** 连接能力 → 协议特性名（握手时回传；guest 只看到被授予的能力）。 */
export function featuresForConnection(conn: BrokerConnection): string[] {
  return [...new Set(conn.capabilities)]
}

function normalizeError(e: unknown): ProtocolError {
  if (isProtocolError(e)) return e
  const err = e as Error
  return protocolError('E_INTERNAL', err?.message ?? String(e))
}

/**
 * 创建受 Broker 保护的 HostHandlers。
 * 注意：`protocol.capabilities` 属于会话元信息，不授予/不触发后端，仅回传绑定信息。
 */
export function brokeredHandlers(broker: Broker, conn: BrokerConnection): HostHandlers {
  const guarded =
    <M extends Exclude<MethodName, 'protocol.capabilities'>>(method: M) =>
    async (params: ProtocolMethods[M]['params']): Promise<ProtocolMethods[M]['result']> => {
      try {
        return await broker.handle(method, params, conn)
      } catch (e) {
        throw normalizeError(e)
      }
    }
  return {
    'protocol.capabilities': () => ({
      protocolVersion: PROTOCOL_VERSION,
      features: featuresForConnection(conn),
      contextId: conn.contextId,
      epoch: conn.epoch,
    }),
    'context.snapshot': guarded('context.snapshot'),
    'context.write': guarded('context.write'),
    'print.snapshot': guarded('print.snapshot'),
    'command.invoke': guarded('command.invoke'),
  }
}
