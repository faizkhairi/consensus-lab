import { INVARIANT_INFO } from '../sim/invariants'
import type { RaftNode } from '../sim/raft'
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

function roleLabel(node: RaftNode): string {
  if (!node.alive) return 'DOWN'
  return node.role.toUpperCase()
}

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
  const violation = cluster.violation
  const violationNodes = new Set(violation?.nodes ?? [])

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
    <section
      aria-label="Cluster"
      className={`rounded-lg border bg-slate-900 p-4 ${
        violation
          ? 'border-red-700/80 shadow-[0_0_0_1px_rgba(239,68,68,0.25),0_0_32px_-8px_rgba(239,68,68,0.45)]'
          : 'border-slate-800'
      }`}
    >
      {violation && (
        <div className="mb-3 rounded-md border border-red-800 bg-red-950/50 px-3 py-2">
          <p className="text-sm font-semibold text-red-300">
            {INVARIANT_INFO[violation.invariant].title} violated at t = {Math.round(violation.time)} ms
          </p>
          <p className="mt-0.5 text-xs text-red-200/90">{violation.message}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-300">
          {leader ? (
            <>
              <span className="font-semibold text-emerald-300">{serverName(leader.id)}</span> leads term{' '}
              {leader.currentTerm}
            </>
          ) : (
            <span className="text-amber-300">No leader: election in progress</span>
          )}
        </p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
            ctl.playing
              ? 'bg-sky-500/10 text-sky-300 ring-sky-500/30'
              : 'bg-slate-800 text-slate-300 ring-slate-700'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${ctl.playing ? 'bg-sky-400 motion-safe:animate-pulse' : 'bg-slate-500'}`}
          />
          {ctl.playing ? 'Running' : 'Paused'}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={clusterLabel}
        className="mx-auto w-full max-w-lg"
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
            <g key={node.id} onClick={() => act(node.id, node.alive)} className="group cursor-pointer">
              <title>{`${node.alive ? 'Crash' : 'Restart'} ${serverName(node.id)}`}</title>
              {node.alive && node.role === 'leader' && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_R + 12}
                  fill={ROLE_COLOR.leader}
                  opacity={0.16}
                  className="motion-safe:animate-pulse"
                />
              )}
              {node.alive && node.role === 'candidate' && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_R + 5}
                  fill="none"
                  stroke={ROLE_COLOR.candidate}
                  strokeWidth={2}
                  className="motion-safe:animate-pulse"
                />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NODE_R + 10}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth={2}
                className="opacity-0 transition-opacity group-hover:opacity-70"
              />
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
              <text
                x={pos.x}
                y={pos.y + NODE_R + 19}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                letterSpacing={0.5}
                fill={node.alive ? ROLE_COLOR[node.role] : '#94a3b8'}
                stroke="#0f172a"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {roleLabel(node)}
              </text>
            </g>
          )
        })}
      </svg>

      <p className="mt-2 text-center text-xs text-slate-400">
        Click a server to crash it, and again to restart it.
      </p>

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
