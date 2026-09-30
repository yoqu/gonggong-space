import { useData, withBase } from 'vitepress'
import { computed } from 'vue'

const zh = {
  hero: {
    kicker: '开源 · 自托管 · 小团队的 AI 协作群',
    title: '共工空间',
    slogan: ['让 AI 同事在群里', '接力干活'],
    tagline: '在群里 @ 一下，队友机器上的 Claude Code / Codex 就开工。过程实时可见，改动随时可审。',
    start: '快速上手',
    about: '共工空间是什么',
    cue: '往下滚动，看一次真实的协作',
  },
  stage: {
    kicker: '真实界面 · 一次完整协作',
    title: ['从一句话，', '到能点开的结果'],
    window: 'todo-app 开发群 — 共工空间',
    mention: '输入 @ 选择要触发的 Bot',
    chapters: [
      {
        title: '@ 一下，就开工',
        body: '在群里 @ Bot 说清需求。没 @ 的讨论自动作为上下文，附件、引用、追加要求一应俱全。',
      },
      {
        title: '在队友的机器上动手',
        body: 'Bot 调用成员本机已登录的 Claude Code / Codex，读代码、改文件、跑命令。工作区与凭据始终留在本机。',
      },
      {
        title: '过程透明，改动可审',
        body: '思考、工具调用、命令输出实时回到群里；diff 与 Git 状态随手查看，越权操作由 Bot 主人批准。',
      },
      {
        title: '结果一键预览',
        body: 'Bot 起的网页、小程序、桌面应用经隧道直达浏览器，多尺寸对照，还能生成限时公开链接。',
      },
    ],
  },
  flow: {
    kicker: '它怎么运转',
    title: ['服务器只管调度，', '活在自己的机器上干'],
    lead: 'Bot 归属某位成员，固定跑在他的机器上。代码、工作区和模型凭据始终留在本机，服务器只转发任务和过程。',
    nodes: [
      { name: '群聊', where: '网页 · 桌面端', body: '成员在群里 @ Bot、看过程、审改动。' },
      { name: '服务器', where: '你的团队部署', body: '保存账号、群与消息，负责调度、中继和记录。' },
      {
        name: '成员的机器',
        where: 'gg 命令行 · 桌面端',
        body: '接活后调用本机已登录的 Claude Code / Codex。',
      },
    ],
    links: [
      { down: '@ 与任务', up: '过程实时推送' },
      { down: '派发到机器', up: '结果与 diff' },
    ],
    more: '看完整架构',
  },
  features: {
    kicker: '能做什么',
    title: ['不替代 Claude Code / Codex，', '把它们接进团队的群'],
    more: '了解',
    items: [
      ['群聊即指挥台', '成员和 Bot 在同一个群里协作。@ 谁谁开工，没 @ 的消息自动作为上下文。'],
      [
        '跑在自己的机器上',
        '调用本机已登录的 Claude Code / Codex，每个「群 × Bot」一个托管工作区，互不干扰。',
      ],
      ['过程透明、改动可审', '思考、工具调用、命令输出实时回传；diff、Git 状态、文件内容随手查看。'],
      ['权限与审批', '只读 / 工作区写入 / 完全访问三档权限，越权操作由 Bot 主人批准，全程留痕。'],
      ['结果一键预览', '网页、服务、小程序、桌面应用画面经隧道直达浏览器，还能生成限时公开链接。'],
      ['团队级管理', '账号角色、机器、客户端自动升级、配置中心、用量统计与审计记录，一处搞定。'],
    ],
  },
  cast: {
    kicker: 'Bot 形象',
    title: '十二种脾气，挑一个当同事',
    lead: '新建 Bot 时，除了共字君，还能从 12 个复合性格里选一个形象。它在群里干活时会跑、会敲键盘、会举手等你审批。',
    personas: {} as Record<string, { gloss: string; mix: string; line: string }>,
  },
  platforms: {
    kicker: '多端',
    title: ['网页、桌面、手机，', '同一个群'],
    lead: '网页端聊天与审阅；macOS 桌面端既是客户端也是执行端，托管 daemon、工作区与隧道；手机上也能看预览、点审批。',
    tour: '界面导览',
    desktop: '桌面端',
    desktopBar: '共工空间 · 桌面端',
  },
  outro: {
    title: '在群里 @ 一下，就开工。',
    lead: '起一台服务器，每位成员绑定自己的机器，建 Bot、拉群，然后 @ 它。',
    admin: '管理员',
    member: '成员',
    start: '跟着快速上手走一遍',
    deploy: '部署运维',
  },
}

type Copy = typeof zh

const en: Copy = {
  hero: {
    kicker: 'Open source · Self-hosted · AI group chat for small teams',
    title: 'Gonggong Space',
    slogan: ['AI teammates that pick up', 'work right in your group chat'],
    tagline:
      'Mention a Bot in a group, and Claude Code / Codex gets to work on a teammate’s machine. Every step is visible live, every change is reviewable.',
    start: 'Quick Start',
    about: 'What is Gonggong Space',
    cue: 'Scroll to watch a real collaboration',
  },
  stage: {
    kicker: 'The real product · one full run',
    title: ['From one message', 'to a clickable result'],
    window: 'todo-app group — Gonggong Space',
    mention: 'Type @ to pick the Bot to trigger',
    chapters: [
      {
        title: 'Mention it, and it starts',
        body: 'Describe the task and @ a Bot. Messages without an @ become context; attachments, quotes and follow-ups all come along.',
      },
      {
        title: 'Works on a teammate’s machine',
        body: 'The Bot drives the Claude Code / Codex already signed in on a member’s machine: reads code, edits files, runs commands. Workspace and credentials never leave it.',
      },
      {
        title: 'Visible process, reviewable changes',
        body: 'Thinking, tool calls and command output stream back to the group; diffs and Git status are one click away, and anything beyond the tier needs the owner’s approval.',
      },
      {
        title: 'One-click previews',
        body: 'Web pages, mini programs and desktop apps the Bot starts reach your browser through a tunnel, side by side at several sizes, with expiring public links to share.',
      },
    ],
  },
  flow: {
    kicker: 'How it works',
    title: ['The server only schedules;', 'the work happens on your machines'],
    lead: 'Each Bot belongs to a member and runs on one of their machines. Code, workspaces and model credentials stay local; the server only relays tasks and progress.',
    nodes: [
      {
        name: 'Group chat',
        where: 'Web · Desktop',
        body: 'Members @ Bots, follow the process and review changes.',
      },
      {
        name: 'Server',
        where: 'Deployed by your team',
        body: 'Stores accounts, groups and messages; schedules, relays and records.',
      },
      {
        name: 'A member’s machine',
        where: 'gg CLI · Desktop',
        body: 'Picks up the task and drives the local, signed-in Claude Code / Codex.',
      },
    ],
    links: [
      { down: '@ and tasks', up: 'live progress' },
      { down: 'dispatch', up: 'results and diffs' },
    ],
    more: 'Read the architecture',
  },
  features: {
    kicker: 'What you get',
    title: ['Not a replacement for Claude Code / Codex —', 'a way to bring them into your team'],
    more: 'Learn more',
    items: [
      [
        'The group chat is the command center',
        'Members and Bots work in one group. Whoever you @ starts working; messages without an @ become context.',
      ],
      [
        'Runs on your own machines',
        'Drives the local, signed-in Claude Code / Codex, with one managed workspace per group × Bot so runs never collide.',
      ],
      [
        'Transparent process, reviewable changes',
        'Thinking, tool calls and command output stream back live; diffs, Git status and files are one click away.',
      ],
      [
        'Permissions and approvals',
        'Read-only, Workspace write and Full access tiers. Anything beyond the tier needs the Bot owner’s approval, and it is all audited.',
      ],
      [
        'One-click previews',
        'Web pages, services, mini programs and desktop apps reach your browser through a tunnel, with expiring public links.',
      ],
      [
        'Team-level management',
        'Accounts and roles, machines, client auto-updates, configuration, usage stats and audit logs in one console.',
      ],
    ],
  },
  cast: {
    kicker: 'Bot characters',
    title: 'Twelve temperaments. Hire one.',
    lead: 'Besides Gong (共字君), every new Bot can take one of 12 blended personalities. In the group it runs, types, and raises a hand when it needs your approval.',
    personas: {
      hammock: {
        gloss: 'Deliberate',
        mix: 'deep thinker × contrarian × keeps boundaries',
        line: 'Looks idle, but is thinking one level deeper. Writes no code until the question is clear.',
      },
      braces: {
        gloss: 'Ironclad',
        mix: 'sharp-tongued × neat freak × doer',
        line: 'Blunt because it cares about clean code. No hand-waving — only implementations that run.',
      },
      focus: {
        gloss: 'Deep Focus',
        mix: 'quiet × zealous × calculating',
        line: 'Headphones on the moment it hits flow. Measures first, then polishes only the critical 3%.',
      },
      steps: {
        gloss: 'Small Steps',
        mix: 'optimistic × pragmatic × cuts scope',
        line: 'Red means fix, green means ship. Zero tolerance for complexity; deletes features with a smile.',
      },
      blank: {
        gloss: 'White Space',
        mix: 'gentle × perfectionist × restrained',
        line: 'Soft-spoken, zero tolerance for rough edges. Every pixel has a reason.',
      },
      no: {
        gloss: 'Says No',
        mix: 'decisive × dutiful × focused',
        line: 'Says no to temptation and yes to users. Calls a halt the moment the direction is wrong.',
      },
      abacus: {
        gloss: 'Abacus',
        mix: 'calm × rational × keeps the books',
        line: 'Ignores stories, reads the ledger: value = new experience − old experience − switching cost.',
      },
      invert: {
        gloss: 'Invert',
        mix: 'pessimist × meticulous × protective',
        line: 'Always asks “how will this break?” — so that it never does.',
      },
      sentry: {
        gloss: 'Sentry',
        mix: 'vigilant × calm × by the book',
        line: 'Assumes it is already breached, yet never spreads panic. Risk is a spectrum, not a switch.',
      },
      spring: {
        gloss: 'Bounce Back',
        mix: 'deadpan × antifragile × less is more',
        line: 'Cracks dry jokes and takes a beating; every incident leaves the system a little stronger.',
      },
      compass: {
        gloss: 'Compass',
        mix: 'gentle but firm × decisive × delegates',
        line: 'Won’t budge on direction, happy to reroute the path. Reversible calls get made on the spot.',
      },
      loop: {
        gloss: 'Retro',
        mix: 'candid × warm × transparent',
        line: 'Lays problems out plainly so people grow. Every milestone gets a retrospective.',
      },
    },
  },
  platforms: {
    kicker: 'Everywhere',
    title: ['Web, desktop and phone,', 'one group'],
    lead: 'Chat and review on the web. The macOS app is both a client and a runner, hosting the daemon, workspaces and tunnels. On the phone you can still open previews and approve.',
    tour: 'Interface tour',
    desktop: 'Desktop app',
    desktopBar: 'Gonggong Space · Desktop',
  },
  outro: {
    title: 'Mention it in the group. Work starts.',
    lead: 'Run one server, let each member bind their machine, create Bots, start a group — then @ one.',
    admin: 'admin',
    member: 'member',
    start: 'Walk through the Quick Start',
    deploy: 'Deployment',
  },
}

/** The home page's words for the current locale, and a link helper that stays inside it. */
export function useCopy() {
  const { lang } = useData()
  const isEn = computed(() => lang.value.startsWith('en'))
  const t = computed(() => (isEn.value ? en : zh))
  const link = (path: string) => withBase((isEn.value ? '/en' : '') + path)
  return { t, isEn, link }
}
