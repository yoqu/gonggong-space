import { protocolEn } from '@gonggong/protocol'
import app from '../app/en'
import admin from '../features/admin/en'
import attachments from '../features/attachments/en'
import auth from '../features/auth/en'
import bots from '../features/bots/en'
import chat from '../features/chat/en'
import config from '../features/config/en'
import diff from '../features/diff/en'
import files from '../features/files/en'
import groups from '../features/groups/en'
import machines from '../features/machines/en'
import notifications from '../features/notifications/en'
import previews from '../features/previews/en'
import reactions from '../features/reactions/en'
import repos from '../features/repos/en'
import runs from '../features/runs/en'
import search from '../features/search/en'
import settings from '../features/settings/en'
import teams from '../features/teams/en'
import usage from '../features/usage/en'
import users from '../features/users/en'
import workbench from '../features/workbench/en'
import workspaces from '../features/workspaces/en'
import lib from '../lib/en'
import ui from '../ui/en'

export const en = {
  ...protocolEn,
  ...app,
  ...ui,
  ...lib,
  ...admin,
  ...attachments,
  ...auth,
  ...bots,
  ...chat,
  ...config,
  ...diff,
  ...files,
  ...groups,
  ...machines,
  ...notifications,
  ...previews,
  ...reactions,
  ...repos,
  ...runs,
  ...search,
  ...teams,
  ...settings,
  ...usage,
  ...users,
  ...workbench,
  ...workspaces,
}
