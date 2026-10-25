import { Presence } from '../../../ui'
import { type GitDialog, useGitDialogs } from '../commands'
import {
  CheckoutDialog,
  CheckoutProblemDialog,
  DeleteBranchDialog,
  DivergedDialog,
  NewBranchDialog,
  RenameBranchDialog,
  RevisionDialog,
} from './BranchDialogs'
import { ContinueDialog, DeleteTagDialog, NewTagDialog, ResetDialog, RewordDialog } from './HistoryDialogs'
import { PushDialog } from './PushDialog'
import { RebaseTodoDialog } from './RebaseTodoDialog'
import { RollbackDialog } from './RollbackDialog'
import { ConfirmDialog, StashDialog, UnstashDialog } from './StashDialogs'
import { MergeDialog, PullDialog, RebaseDialog, UpdateDialog } from './SyncDialogs'
import '../dialogs.css'

/** The git dialog open anywhere in the workbench; mounted once. */
export function GitDialogHost() {
  const open = useGitDialogs((s) => s.open)
  const close = useGitDialogs((s) => s.close)
  return <Presence>{open ? <Body key={JSON.stringify(open)} {...open} onClose={close} /> : null}</Presence>
}

function Body({
  target,
  dialog: d,
  onClose,
}: {
  target: Parameters<typeof CheckoutDialog>[0]['target']
  dialog: GitDialog
  onClose: () => void
}) {
  const p = { target, onClose }
  switch (d.kind) {
    case 'checkout':
      return <CheckoutDialog {...p} rev={d.ref} detach={d.detach} />
    case 'checkout-problem':
      return <CheckoutProblemDialog {...p} op={d.op} />
    case 'diverged':
      return <DivergedDialog {...p} op={d.op} />
    case 'revision':
      return <RevisionDialog {...p} />
    case 'branch-create':
      return <NewBranchDialog {...p} from={d.from} />
    case 'branch-rename':
      return <RenameBranchDialog {...p} branch={d.branch} />
    case 'branch-delete':
      return <DeleteBranchDialog {...p} branch={d.branch} />
    case 'merge':
      return <MergeDialog {...p} branch={d.branch} />
    case 'rebase':
      return <RebaseDialog {...p} onto={d.onto} branch={d.branch} />
    case 'rebase-todo':
      return <RebaseTodoDialog {...p} commit={d.commit} pushed={d.pushed} />
    case 'pull':
      return <UpdateDialog {...p} />
    case 'pull-remote':
      return <PullDialog {...p} />
    case 'push':
      return <PushDialog {...p} branch={d.branch} upTo={d.upTo} />
    case 'reset':
      return <ResetDialog {...p} commit={d.commit} />
    case 'reword':
      return <RewordDialog {...p} head={d.head} />
    case 'continue':
      return <ContinueDialog {...p} ongoing={d.ongoing} />
    case 'tag-create':
      return <NewTagDialog {...p} commit={d.commit} />
    case 'tag-delete':
      return <DeleteTagDialog {...p} name={d.name} />
    case 'stash':
      return <StashDialog {...p} paths={d.paths} />
    case 'unstash':
      return <UnstashDialog {...p} stash={d.stash} initialPop={d.initialPop} />
    case 'rollback':
      return <RollbackDialog {...p} changes={d.changes} />
    case 'confirm':
      return <ConfirmDialog {...p} confirm={d.confirm} />
  }
}
