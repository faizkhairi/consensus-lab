import type { LogEntry } from '../sim/types'
import { termColor } from './colors'
import type { SimController } from './controller'
import { useSim } from './useSim'

const WINDOW = 24

interface Props {
  readonly ctl: SimController
}

function cellTitle(index: number, entry: LogEntry, committed: boolean): string {
  return `index ${index}, term ${entry.term}, ${entry.cmd}, ${committed ? 'committed' : 'uncommitted'}`
}

export function LogGrid({ ctl }: Props) {
  useSim(ctl)
  const cluster = ctl.cluster
  const nodes = cluster.nodes
  const longest = Math.max(1, cluster.oracle.committed.length, ...nodes.map((n) => n.log.length))

  let start = Math.max(1, longest - (WINDOW - 1))
  let end = longest
  const violationIndex = cluster.violation?.index
  if (violationIndex !== undefined) {
    if (violationIndex > end) {
      end = violationIndex
      start = Math.max(1, end - (WINDOW - 1))
    } else if (violationIndex < start) {
      start = violationIndex
    }
  }
  const columns = Array.from({ length: end - start + 1 }, (_, i) => start + i)

  const cell = (entry: LogEntry | undefined, index: number, committed: boolean) => {
    const isViolationColumn = index === violationIndex
    const base = 'h-8 w-8 shrink-0 border text-center text-[11px] font-medium leading-8'
    const border = isViolationColumn ? 'border-red-500 border-2' : 'border-slate-700'
    if (!entry) return <td key={index} className={`${base} ${border}`} />
    const color = termColor(entry.term, committed ? 45 : 55)
    const style = committed
      ? { backgroundColor: color, color: '#020617', borderColor: color }
      : { color, borderColor: color }
    return (
      <td
        key={index}
        className={`${base} ${isViolationColumn ? 'border-2 border-red-500' : ''}`}
        style={style}
      >
        <span title={cellTitle(index, entry, committed)}>{entry.cmd === 'noop' ? '·' : entry.cmd}</span>
      </td>
    )
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold text-slate-200">Replicated logs</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="border-separate border-spacing-0.5">
          <caption className="sr-only">Replicated logs by server, with the oracle's committed view</caption>
          <thead>
            <tr>
              <th scope="col" className="w-16 text-left text-xs font-medium text-slate-400">
                Committed
              </th>
              {columns.map((index) => {
                const entry = cluster.oracle.committed[index - 1]
                return cell(entry, index, true)
              })}
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                <th scope="row" className="w-16 text-left text-xs font-medium text-slate-400">
                  S{node.id + 1}
                </th>
                {columns.map((index) => {
                  const entry = node.log[index - 1]
                  return cell(entry, index, index <= node.commitIndex)
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        indices {start} to {end} of {longest}
      </p>
    </section>
  )
}
