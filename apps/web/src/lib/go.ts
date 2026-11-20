/** Navigates in-app from code that may sit outside the router (a toast action): BrowserRouter follows popstate. */
export function go(to: string) {
  history.pushState(null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
}
