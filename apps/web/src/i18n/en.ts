import { protocolEn } from '@gonggong/protocol'
import app from '../app/en'
import admin from '../features/admin/en'
import artifacts from '../features/artifacts/en'
import attachments from '../features/attachments/en'
import auth from '../features/auth/en'
import bots from '../features/bots/en'
import chat from '../features/chat/en'
import config from '../features/config/en'
import conversationStats from '../features/conversation-stats/en'
import diff from '../features/diff/en'
import feishu from '../features/feishu/en'
import files from '../features/files/en'
import git from '../features/git/en'
import gitLog from '../features/git/log-en'
import groupTabs from '../features/group-tabs/en'
import groups from '../features/groups/en'
import knowledge from '../features/knowledge/en'
import machines from '../features/machines/en'
import notifications from '../features/notifications/en'
import plugins from '../features/plugins/en'
import previews from '../features/previews/en'
import reactions from '../features/reactions/en'
import repos from '../features/repos/en'
import rich from '../features/rich/en'
import runs from '../features/runs/en'
import schedules from '../features/schedules/en'
import search from '../features/search/en'
import secrets from '../features/secrets/en'
import settings from '../features/settings/en'
import sync from '../features/sync/en'
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
  ...artifacts,
  ...attachments,
  ...auth,
  ...bots,
  ...chat,
  ...config,
  ...conversationStats,
  ...diff,
  ...feishu,
  ...files,
  ...git,
  ...gitLog,
  ...groupTabs,
  ...groups,
  ...knowledge,
  ...machines,
  ...notifications,
  ...plugins,
  ...previews,
  ...reactions,
  ...rich,
  ...repos,
  ...runs,
  ...schedules,
  ...search,
  ...secrets,
  ...sync,
  ...teams,
  ...settings,
  ...usage,
  ...users,
  ...workbench,
  ...workspaces,
}
