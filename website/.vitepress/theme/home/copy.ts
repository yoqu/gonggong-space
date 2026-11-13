import { useData, withBase } from 'vitepress'
import { computed } from 'vue'

const zh = {
  hero: {
    kicker: '开源 · 自托管 · 小团队的 AI 协作群',
    title: '共工空间',
    slogan: ['让 AI 同事在群里', '接力干活'],
    tagline:
      '在群里 @ 一下，队友机器上的 Claude Code、Codex 等 Agent 就开工。过程实时可见，改动随时可审，做好的页面在群里直接打开。',
    start: '快速上手',
    about: '共工空间是什么',
  },
  stage: {
    kicker: '真实界面 · 一次完整协作',
    title: ['从一句话，', '到能点开的结果'],
    window: 'todo-app 开发群 — 共工空间',
    mention: '输入 @ 选择要触发的 Bot',
    chapters: [
      {
        title: '@ 一下，就开工',
        body: '在群里 @ Bot 说清需求。没 @ 的讨论自动作为上下文，附件、引用、追加要求一应俱全；支线讨论收进话题，不刷屏。',
      },
      {
        title: '在队友的机器上动手',
        body: 'Bot 调用成员本机的 Claude Code、Codex、Gemini CLI 等 Agent，读代码、改文件、跑命令。工作区与凭据始终留在本机。',
      },
      {
        title: '过程透明，审批省心',
        body: '思考、工具调用、命令输出实时回到群里；diff 与 Git 随手查看。常规操作「帮我审批」直接放行，只有风险操作才找 Bot 主人。',
      },
      {
        title: '结果一键预览',
        body: 'Bot 起的网页、小程序、桌面应用经隧道直达浏览器，多尺寸对照；原型在画布上批注迭代，还能生成限时公开链接。',
      },
    ],
  },
  flow: {
    kicker: '它怎么运转',
    title: ['服务器只管调度，', '活在自己的机器上干'],
    lead: 'Bot 归属某位成员，固定跑在他的机器上。代码、工作区和模型凭据始终留在本机，服务器只转发任务和过程。',
    nodes: [
      { name: '群聊', where: '网页 · 桌面端 · 飞书', body: '成员在群里 @ Bot、看过程、审改动。' },
      { name: '服务器', where: '你的团队部署', body: '保存账号、群与消息，负责调度、中继和记录。' },
      {
        name: '成员的机器',
        where: 'gg 命令行 · 桌面端 · Docker',
        body: '接活后调用本机的 Claude Code、Codex 等 Agent。',
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
    title: ['不替代你的 Agent，', '把它们接进团队的群'],
    more: '了解',
    items: [
      [
        '一句话接入',
        '把一句话发给本机的 Claude Code 或 Codex，它自己装好 gg、绑定机器、后台常驻，Bot 和私聊随即就绪。',
      ],
      ['群聊即指挥台', '@ 谁谁开工，Bot 之间能接力；话题收住支线讨论，定时任务到点自动开工。'],
      [
        '过程透明、Git 在手',
        '思考、工具调用、命令输出实时回传；diff、提交、日志、冲突处理都在 Git 面板里完成。',
      ],
      ['审批不打断', '每次问我、帮我审批、完全允许三种方式；AI 预审先过一遍，只把风险操作交给 Bot 主人。'],
      ['从预览到原型', '网页、小程序、桌面应用画面直达浏览器；原型放上多屏画布批注、迭代，再一键分享。'],
      ['团队的经验沉淀下来', 'Skill 市场、插件、群知识库与分层密钥，让每个 Bot 都带着团队的约定干活。'],
    ],
  },
  cast: {
    kicker: 'Bot 形象',
    title: '十二种脾气，挑一个当同事',
    lead: '新建 Bot 默认用 Agent 的官方形象，也能换成共字君或 12 个复合性格之一。它在群里干活时会跑、会敲键盘、会举手等你审批。',
    personas: {} as Record<string, { gloss: string; mix: string; line: string }>,
  },
  platforms: {
    kicker: '多端',
    title: ['网页、桌面、手机，', '同一个群'],
    lead: '网页端聊天与审阅；桌面端（macOS、Windows）既是客户端也是执行端，托管 daemon、工作区与隧道；Linux 服务器用 gg 常驻；手机浏览器里也能看进度、点审批。',
    tour: '界面导览',
    desktop: '桌面端',
    desktopBar: '共工空间 · 桌面端',
  },
  outro: {
    title: '在群里 @ 一下，就开工。',
    lead: '起一台服务器，每位成员把一句话发给自己的 Agent，机器和 Bot 就接进来了。然后拉群，@ 它。',
    admin: '管理员',
    member: '成员',
    steps: [
      ['admin', 'GONGGONG_ADMIN_PASSWORD=初始密码 docker compose up -d'],
      [
        'member',
        '帮我接入共工空间：读取 https://gg.example.com/api/install.md 并按步骤执行，接入码 K7QM-4X2P。',
      ],
      ['member', '@后端助手 给待办加一个截止日期字段，跑完测试'],
    ] as [who: 'admin' | 'member', cmd: string][],
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
      'Mention a Bot in a group, and Claude Code, Codex or another Agent gets to work on a teammate’s machine. Every step is visible live, every change is reviewable, and what it builds opens right in the chat.',
    start: 'Quick Start',
    about: 'What is Gonggong Space',
  },
  stage: {
    kicker: 'The real product · one full run',
    title: ['From one message', 'to a clickable result'],
    window: 'todo-app group — Gonggong Space',
    mention: 'Type @ to pick the Bot to trigger',
    chapters: [
      {
        title: 'Mention it, and it starts',
        body: 'Describe the task and @ a Bot. Messages without an @ become context; attachments, quotes and follow-ups all come along, and side discussions go into threads.',
      },
      {
        title: 'Works on a teammate’s machine',
        body: 'The Bot drives Claude Code, Codex, Gemini CLI or another Agent on a member’s machine: reads code, edits files, runs commands. Workspace and credentials never leave it.',
      },
      {
        title: 'Visible process, painless approvals',
        body: 'Thinking, tool calls and command output stream back to the group; diffs and Git are one click away. With Review for me, routine work goes through and only risky actions reach the Bot’s owner.',
      },
      {
        title: 'One-click previews',
        body: 'Web pages, mini programs and desktop apps the Bot starts reach your browser through a tunnel, side by side at several sizes; prototypes get annotated on a canvas, and expiring public links share them.',
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
        where: 'Web · Desktop · Feishu',
        body: 'Members @ Bots, follow the process and review changes.',
      },
      {
        name: 'Server',
        where: 'Deployed by your team',
        body: 'Stores accounts, groups and messages; schedules, relays and records.',
      },
      {
        name: 'A member’s machine',
        where: 'gg CLI · Desktop · Docker',
        body: 'Picks up the task and drives the local Claude Code, Codex or another Agent.',
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
    title: ['Not a replacement for your Agents —', 'a way to bring them into your team'],
    more: 'Learn more',
    items: [
      [
        'One message to connect',
        'Paste one message to the Claude Code or Codex on your machine. It installs gg, binds the machine and keeps it running; your Bot and its chat are ready.',
      ],
      [
        'The group chat is the command center',
        'Whoever you @ starts working, and Bots hand tasks to each other. Threads hold side discussions; scheduled tasks start on time.',
      ],
      [
        'Transparent process, Git at hand',
        'Thinking, tool calls and command output stream back live; diffs, commits, logs and conflict resolution live in the Git panel.',
      ],
      [
        'Approvals that don’t get in the way',
        'Ask me every time, Review for me, or Allow everything. AI pre-review screens requests first and only risky ones reach the Bot’s owner.',
      ],
      [
        'From preview to prototype',
        'Web pages, mini programs and desktop app windows reach your browser; prototypes go on a multi-screen canvas to annotate, iterate and share.',
      ],
      [
        'Your team’s know-how, kept',
        'A Skill market, plugins, group knowledge bases and layered secrets mean every Bot works by your team’s conventions.',
      ],
    ],
  },
  cast: {
    kicker: 'Bot characters',
    title: 'Twelve temperaments. Hire one.',
    lead: 'A new Bot wears its Agent’s official look by default, or switch to Gong (共字君) or one of 12 blended personalities. In the group it runs, types, and raises a hand when it needs your approval.',
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
    lead: 'Chat and review on the web. The desktop app (macOS, Windows) is both a client and a runner, hosting the daemon, workspaces and tunnels; Linux servers keep gg running as a service. On a phone browser you can still follow runs and approve.',
    tour: 'Interface tour',
    desktop: 'Desktop app',
    desktopBar: 'Gonggong Space · Desktop',
  },
  outro: {
    title: 'Mention it in the group. Work starts.',
    lead: 'Run one server. Each member pastes one message to their own Agent, and the machine and Bot join. Then start a group and @ one.',
    admin: 'admin',
    member: 'member',
    steps: [
      ['admin', 'GONGGONG_ADMIN_PASSWORD=<password> docker compose up -d'],
      [
        'member',
        '帮我接入共工空间：读取 https://gg.example.com/api/install.md 并按步骤执行，接入码 K7QM-4X2P。',
      ],
      ['member', '@Backend Helper add a due date to todos and run the tests'],
    ],
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
