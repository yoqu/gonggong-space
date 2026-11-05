import { named } from '../../lib/lazy'

export const BindMachineDialog = named(() => import('./BindMachineDialog'), 'BindMachineDialog')
export const MachinePage = named(() => import('./MachinePage'), 'MachinePage')
export const MachinesOverview = named(() => import('./MachinesOverview'), 'MachinesOverview')
