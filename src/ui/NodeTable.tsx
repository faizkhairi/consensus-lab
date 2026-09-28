import type { SimController } from './controller'
import { useSim } from './useSim'

interface Props {
  readonly ctl: SimController
}

const serverName = (id: number) => `S${id + 1}`

export function NodeTable({ ctl }: Props) {
  useSim(ctl)
  const cluster = ctl.cluster

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      {/* relative: keeps the sr-only header (absolute) inside the scroll box, or it widens the page */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-sm font-semibold text-slate-200">Servers</caption>
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Server
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Role
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Term
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Voted for
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Commit
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Log length
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {cluster.nodes.map((node) => (
              <tr key={node.id} className="border-b border-slate-800/60 last:border-0">
                <td className="py-1.5 pr-3 font-medium text-slate-200">
                  {serverName(node.id)}
                  {!node.alive && <span className="ml-1 text-xs text-rose-400">(down)</span>}
                </td>
                <td className="py-1.5 pr-3 capitalize text-slate-300">{node.role}</td>
                <td className="py-1.5 pr-3 text-slate-300">{node.currentTerm}</td>
                <td className="py-1.5 pr-3 text-slate-300">
                  {node.votedFor === null ? '-' : serverName(node.votedFor)}
                </td>
                <td className="py-1.5 pr-3 text-slate-300">{node.commitIndex}</td>
                <td className="py-1.5 pr-3 text-slate-300">{node.log.length}</td>
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() =>
                      ctl.act(
                        node.alive ? { type: 'crash', node: node.id } : { type: 'restart', node: node.id },
                      )
                    }
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                  >
                    {node.alive ? `Crash ${serverName(node.id)}` : `Restart ${serverName(node.id)}`}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
