// Web Push (plan D13): shows server-sent notifications even when no page is open; a click opens the target.
self.addEventListener('push', (event) => {
  const { title, body, url } = event.data.json()
  event.waitUntil(self.registration.showNotification(title, { body, data: { url } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data.url))
})
