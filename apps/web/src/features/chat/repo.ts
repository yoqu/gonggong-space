/** `git@x:team/pay.git` / `https://…/pay` / `file:///…/pay` → `pay`: the name people say, not the URL. */
export const repoName = (url: string) =>
  url
    .replace(/\/+$/, '')
    .split(/[:/]/)
    .at(-1)
    ?.replace(/\.git$/, '') ?? url
