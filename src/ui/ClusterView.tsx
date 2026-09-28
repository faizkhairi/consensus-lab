import type { Envelope, Message, NodeId } from '../sim/types'
import {
  APPEND_ENTRIES_COLOR,
  APPEND_REPLY_COLOR,
  DROP_MARK_COLOR,
  EDGE_COLOR,
  ELECTION_RING_COLOR,
  PARTITION_CUT_COLOR,
  ROLE_COLOR,
  ROLE_COLOR_CRASHED,
  VIOLATION_RING_COLOR,
  VOTE_DENIED_COLOR,
  VOTE_GRANTED_COLOR,
  VOTE_REQUEST_COLOR,
} from './colors'
import type { SimController } from './controller'
import { useSim } from './useSim'

const SIZE = 400
const CENTER = SIZE / 2
const RADIUS = 140
const NODE_R = 30
const RING_R = NODE_R + 6
const DROP_WINDOW_MS = 40

const serverName = (id: NodeId) => `S${id + 1}`

function nodePos(id: NodeId, count: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (id * 2 * Math.PI) / count
  return { x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) }
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

interface MessageStyle {
  readonly color: string
  readonly radius: number
}

function messageStyle(msg: Message): MessageStyle {
  switch (msg.type) {
    case 'RequestVote':
      return { color: VOTE_REQUEST_COLOR, radius: 4 }
    case 'RequestVoteReply':
      return { color: msg.voteGranted ? VOTE_GRANTED_COLOR : VOTE_DENIED_COLOR, radius: 4 }
    case 'AppendEntries':
      return { color: APPEND_ENTRIES_COLOR, radius: msg.entries.length > 0 ? 6 : 3.5 }
    case 'AppendEntriesReply':
      return { color: APPEND_REPLY_COLOR, radius: 3 }
  }
}

interface Props {
  readonly ctl: SimController
}

export function ClusterView({ ctl }: Props) {
  useSim(ctl)
  const cluster = ctl.cluster
  const nodes = cluster.nodes
  const count = nodes.length
  const positions = nodes.map((node) => nodePos(node.id, count))
  const leader = cluster.leader
  const violationNodes = new Set(cluster.violation?.nodes ?? [])

  const clusterLabel = [
    `Cluster of ${count} servers.`,
    leader ? `${serverName(leader.id)} is leader of term ${leader.currentTerm}.` : 'No leader.',
    ...nodes.filter((n) => !n.alive).map((n) => `${serverName(n.id)} is down.`),
  ].join(' ')

  const edges: { a: NodeId; b: NodeId; cut: boolean }[] = []
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) edges.push({ a, b, cut: !cluster.canReach(a, b) })
  }

  const messages = [...cluster.inFlight.values()]
  const drops = cluster.recentDrops.filter((d) => cluster.now - d.time < DROP_WINDOW_MS)

  const act = (node: NodeId, alive: boolean) => {
    if (alive) ctl.act({ type: 'crash', node })
    else ctl.act({ type: 'restart', node })
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={clusterLabel}
        className="mx-auto w-full max-w-md"
      >
        <title>{clusterLabel}</title>
        {edges.map(({ a, b, cut }) => {
          const pa = positions[a] as { x: number; y: number }
          const pb = positions[b] as { x: number; y: number }
          return (
            <line
              key={`edge-${a}-${b}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke={cut ? PARTITION_CUT_COLOR : EDGE_COLOR}
              strokeWidth={cut ? 1.5 : 1}
              strokeDasharray={cut ? '5 4' : undefined}
              opacity={cut ? 0.85 : 1}
            />
          )
        })}

        {nodes.map((node) => {
          const pos = positions[node.id] as { x: number; y: number }
          if (!node.alive || node.role === 'leader') return null
          const span = node.electionDeadline - node.electionStart
          const remaining = span > 0 ? (node.electionDeadline - cluster.now) / span : 0
          const fraction = Math.min(1, Math.max(0, remaining))
          const circumference = 2 * Math.PI * RING_R
          return (
            <circle
              key={`ring-${node.id}`}
              cx={pos.x}
              cy={pos.y}
              r={RING_R}
              fill="none"
              stroke={ELECTION_RING_COLOR}
              strokeWidth={2}
              strokeOpacity={0.6}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fraction)}
              transform={`rotate(-90 ${pos.x} ${pos.y})`}
            />
          )
        })}

        {messages.map((env: Envelope) => {
          const from = positions[env.from] as { x: number; y: number }
          const to = positions[env.to] as { x: number; y: number }
          const span = env.deliverAt - env.sentAt
          const t = span > 0 ? Math.min(1, Math.max(0, (cluster.now - env.sentAt) / span)) : 1
          const at = lerp(from, to, t)
          const dx = to.x - from.x
          const dy = to.y - from.y
          const len = Math.hypot(dx, dy) || 1
          const px = -dy / len
          const py = dx / len
          const offset = env.from < env.to ? 4.5 : -4.5
          const style = messageStyle(env.msg)
          const unreachable = !cluster.canReach(env.from, env.to)
          const targetDown = !(cluster.nodes[env.to]?.alive ?? true)
          const dim = unreachable || targetDown
          return (
            <circle
              key={`msg-${env.id}`}
              cx={at.x + px * offset}
              cy={at.y + py * offset}
              r={style.radius}
              fill={style.color}
              opacity={dim ? 0.3 : 0.95}
            />
          )
        })}

        {drops.map((drop) => {
          const from = positions[drop.env.from] as { x: number; y: number }
          const to = positions[drop.env.to] as { x: number; y: number }
          const dx = to.x - from.x
          const dy = to.y - from.y
          const len = Math.hypot(dx, dy) || 1
          const ux = dx / len
          const uy = dy / len
          const x = to.x - ux * (NODE_R + 12)
          const y = to.y - uy * (NODE_R + 12)
          return (
            <g key={`drop-${drop.env.id}`} stroke={DROP_MARK_COLOR} strokeWidth={2}>
              <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} />
              <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} />
            </g>
          )
        })}

        {nodes.map((node) => {
          const pos = positions[node.id] as { x: number; y: number }
          const fill = node.alive ? ROLE_COLOR[node.role] : ROLE_COLOR_CRASHED[node.role]
          return (
            // Mouse shortcut only: the SVG is one labelled image, and the server table's
            // Crash and Restart buttons are the keyboard and screen-reader path.
            // biome-ignore lint/a11y/noStaticElementInteractions: see above
            <g key={node.id} onClick={() => act(node.id, node.alive)} className="cursor-pointer">
              {violationNodes.has(node.id) && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_R + 4}
                  fill="none"
                  stroke={VIOLATION_RING_COLOR}
                  strokeWidth={2.5}
                />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NODE_R}
                fill={fill}
                stroke={node.alive ? '#0f172a' : '#64748b'}
                strokeWidth={node.alive ? 1.5 : 2}
                strokeDasharray={node.alive ? undefined : '4 3'}
                opacity={node.alive ? 1 : 0.6}
              />
              <text x={pos.x} y={pos.y - 2} textAnchor="middle" fontSize={13} fontWeight={700} fill="#020617">
                {serverName(node.id)}
              </text>
              <text x={pos.x} y={pos.y + 12} textAnchor="middle" fontSize={10} fill="#020617">
                T{node.currentTerm}
              </text>
            </g>
          )
        })}
      </svg>

      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: ROLE_COLOR.follower }}
          />
          Follower
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: ROLE_COLOR.candidate }}
          />
          Candidate
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: ROLE_COLOR.leader }}
          />
          Leader
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: VOTE_REQUEST_COLOR }}
          />
          RequestVote
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: VOTE_GRANTED_COLOR }}
          />
          Vote granted
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: VOTE_DENIED_COLOR }}
          />
          Vote denied
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: APPEND_ENTRIES_COLOR }}
          />
          AppendEntries
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: APPEND_REPLY_COLOR }}
          />
          Append reply
        </li>
      </ul>
    </section>
  )
}
