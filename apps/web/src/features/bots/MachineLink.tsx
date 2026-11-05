import { Link } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { BINDING_LABEL } from './model'

/** A bot's 执行机器: a link to the machine page when the machine is one of mine, plain text otherwise. */
export function MachineLink({ id, name }: { id: string | null; name: string | null }) {
  const mine = useWorkspace((s) => !!id && s.machines.some((m) => m.id === id))
  const text = name ?? BINDING_LABEL.pending_bind
  return mine ? <Link to={`/machine/${id}`}>{text}</Link> : text
}
